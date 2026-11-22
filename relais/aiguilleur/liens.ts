// Responsabilité : les liens ouverts des membres — qui est connecté, qui peut parler à qui, les canaux (via Canaux),
// la présence diffusée et le balayage des jetons révoqués. Les charges sont relayées sans être lues ni journalisées.
import type { Logger } from 'pino';
import type { ServerWebSocket } from 'bun';
import {
  analyserVersAiguilleur,
  type MessageDeAiguilleur,
  type MotifErreur,
  LIMITE_CHARGE_OCTETS,
  octetsCharge,
} from '../../commun/aiguilleur.ts';
import type { Annuaire, Membre } from './annuaire.ts';
import { Canaux } from './canaux.ts';

export interface DonneesLien {
  readonly membre: string;
}

export type Lien = ServerWebSocket<DonneesLien>;

/** Codes de fermeture du lien : révoqué (le jeton n'existe plus), remplacé (une nouvelle connexion du même membre). */
export const CODE_REVOQUE = 4401;
export const CODE_REMPLACE = 4409;

export class Liens {
  private readonly connectes = new Map<string, Lien>();
  private readonly canaux: Canaux;
  private revoques = '';

  constructor(
    private readonly annuaire: Annuaire,
    private readonly journal: Logger,
    maxCanaux?: number,
  ) {
    this.canaux = new Canaux(maxCanaux);
  }

  ouvrir(ws: Lien): void {
    this.securise('connexion', () => this.connecter(ws));
  }

  private connecter(ws: Lien): void {
    const id = ws.data.membre;
    const precedent = this.connectes.get(id);
    if (precedent) {
      this.connectes.delete(id);
      this.retirerCanaux(id);
      precedent.close(CODE_REMPLACE, 'remplacé');
    }
    this.connectes.set(id, ws);
    this.journal.info({ membre: id }, 'membre connecté');
    this.diffuserPresence();
  }

  fermer(ws: Lien): void {
    this.securise('déconnexion', () => this.deconnecter(ws));
  }

  private deconnecter(ws: Lien): void {
    const id = ws.data.membre;
    if (this.connectes.get(id) !== ws) return;
    this.connectes.delete(id);
    this.retirerCanaux(id);
    this.journal.info({ membre: id }, 'membre déconnecté');
    this.diffuserPresence();
  }

  /** Un message brut d'un membre : analysé, puis traité. Un message mal formé est refusé sans rien relayer. */
  recevoir(ws: Lien, brut: string | Buffer): void {
    this.securise('message', () => this.traiter(ws, brut));
  }

  private traiter(ws: Lien, brut: string | Buffer): void {
    const message = analyserVersAiguilleur(lireJson(String(brut)));
    if (!message) return this.erreur(ws, 'message-invalide');
    switch (message.t) {
      case 'ouvrir':
        return this.ouvrirCanal(ws, message.canal, message.vers);
      case 'accepter':
      case 'refuser':
        return this.decider(ws, message.canal, message.t);
      case 'donnees':
        return this.transmettre(ws, message.canal, message.charge);
      case 'fermer':
        return this.fermerCanal(ws, message.canal);
    }
  }

  /** Ferme les liens des membres révoqués (le jeton n'existe plus) et diffuse la présence qui en découle. */
  balayer(): void {
    this.securise('balayage', () => this.balayerRevoques());
  }

  private balayerRevoques(): void {
    let change = false;
    for (const [id, ws] of [...this.connectes]) {
      const membre = this.annuaire.membre(id);
      if (membre && !membre.revoqueLe) continue;
      this.connectes.delete(id);
      this.retirerCanaux(id);
      this.journal.warn({ membre: id }, 'membre révoqué : connexion coupée');
      ws.close(CODE_REVOQUE, 'révoqué');
      change = true;
    }
    // Un révoqué hors ligne doit aussi disparaître de la présence des autres : on compare les révoqués.
    const revoques = this.annuaire.membres().filter((m) => m.revoqueLe).map((m) => m.id).sort().join(',');
    if (change || revoques !== this.revoques) {
      this.revoques = revoques;
      this.diffuserPresence();
    }
  }

  /** Envoie à chaque membre connecté la liste des membres qu'il voit (état, nom, genre, propriétaire). */
  diffuserPresence(): void {
    const tous = this.annuaire.membres();
    for (const [id, ws] of this.connectes) {
      const moi = tous.find((m) => m.id === id);
      if (!moi) continue;
      const ouverts = this.canaux.correspondantsOuverts(moi.id);
      const membres = tous
        .filter((x) => this.voit(moi, x, ouverts))
        .map((x) => ({
          id: x.id,
          enLigne: this.connectes.has(x.id),
          nom: x.nom,
          genre: x.genre,
          proprietaire: x.proprietaire,
        }));
      this.envoyerA(ws, { t: 'presence', membres, proprietaire: moi.proprietaire });
    }
  }

  /**
   * Présence : tout le même propriétaire ; un autre propriétaire seulement si son lien duo existe ET qu'un canal
   * avec ce membre a été accepté (ouvert). Jamais soi-même, jamais un membre révoqué.
   */
  private voit(moi: Membre, x: Membre, ouverts: ReadonlySet<string>): boolean {
    if (moi.id === x.id || moi.revoqueLe || x.revoqueLe) return false;
    if (moi.proprietaire === x.proprietaire) return true;
    return ouverts.has(x.id) && this.annuaire.duoLie(moi.proprietaire, x.proprietaire);
  }

  /** Demande de canal : même propriétaire, ou propriétaires liés par un duo ; jamais vers soi-même. */
  private peutDemander(a: Membre, b: Membre): boolean {
    if (a.id === b.id || a.revoqueLe || b.revoqueLe) return false;
    return a.proprietaire === b.proprietaire || this.annuaire.duoLie(a.proprietaire, b.proprietaire);
  }

  private ouvrirCanal(ws: Lien, canal: string, vers: string): void {
    const de = this.annuaire.membre(ws.data.membre);
    const cible = this.annuaire.membre(vers);
    if (!de || !cible || !this.peutDemander(de, cible)) {
      this.journal.warn({ de: ws.data.membre, vers, canal }, 'ouverture refusée : non autorisée');
      return this.erreur(ws, 'non-autorise', canal);
    }
    const destinataire = this.connectes.get(cible.id);
    // Hors ligne : un autre propriétaire ne doit pas apprendre que ce nœud existe ni son état.
    if (!destinataire) {
      const motif = de.proprietaire === cible.proprietaire ? 'hors-ligne' : 'non-autorise';
      return this.erreur(ws, motif, canal);
    }
    const motif = this.canaux.ouvrir(de.id, cible.id, canal);
    if (motif) return this.erreur(ws, motif, canal);
    this.envoyerA(destinataire, { t: 'ouvrir', canal, de: de.id, proprietaire: de.proprietaire });
    this.journal.info({ de: de.id, vers: cible.id, canal }, 'canal demandé');
  }

  private decider(ws: Lien, canal: string, decision: 'accepter' | 'refuser'): void {
    const r = this.canaux.decider(ws.data.membre, canal, decision);
    if (!r.ok) return this.erreur(ws, r.motif, canal);
    const ouvrant = this.connectes.get(r.valeur);
    if (ouvrant) this.envoyerA(ouvrant, { t: decision, canal });
    if (decision === 'accepter') this.diffuserPresence();
    this.journal.info({ membre: ws.data.membre, canal, decision }, 'décision sur un canal');
  }

  private transmettre(ws: Lien, canal: string, charge: string): void {
    const r = this.canaux.acheminer(ws.data.membre, canal);
    if (!r.ok) return this.erreur(ws, r.motif, canal);
    if (octetsCharge(charge) > LIMITE_CHARGE_OCTETS) {
      this.journal.warn({ membre: ws.data.membre, canal }, 'charge refusée : au-delà de la limite');
      return this.erreur(ws, 'charge-trop-grande', canal);
    }
    const destinataire = this.connectes.get(r.valeur);
    if (!destinataire) return this.erreur(ws, 'hors-ligne', canal);
    this.envoyerA(destinataire, { t: 'donnees', canal, charge });
  }

  private fermerCanal(ws: Lien, canal: string): void {
    const pair = this.canaux.fermer(ws.data.membre, canal);
    if (pair === null) return this.erreur(ws, 'canal-inconnu', canal);
    const correspondant = this.connectes.get(pair);
    if (correspondant) this.envoyerA(correspondant, { t: 'fermer', canal });
    this.diffuserPresence();
    this.journal.info({ membre: ws.data.membre, canal }, 'canal fermé');
  }

  private retirerCanaux(id: string): void {
    for (const { pair, canal } of this.canaux.retirer(id)) {
      const correspondant = this.connectes.get(pair);
      if (correspondant) this.envoyerA(correspondant, { t: 'fermer', canal });
    }
  }

  /** Une erreur de base ou d'écriture ne doit jamais faire tomber l'aiguilleur : elle est journalisée, sans charge. */
  private securise(quoi: string, action: () => void): void {
    try {
      action();
    } catch (e) {
      this.journal.error({ err: e }, `${quoi} : erreur de l’aiguilleur, lien laissé en l’état`);
    }
  }

  private erreur(ws: Lien, motif: MotifErreur, canal?: string): void {
    this.envoyerA(ws, canal === undefined ? { t: 'erreur', motif } : { t: 'erreur', canal, motif });
  }

  private envoyerA(ws: Lien, message: MessageDeAiguilleur): void {
    ws.send(JSON.stringify(message));
  }
}

function lireJson(texte: string): unknown {
  try {
    return JSON.parse(texte);
  } catch {
    return null;
  }
}
