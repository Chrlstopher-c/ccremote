// Responsabilité : ce qui traverse le lien duo — ce qu'on envoie au pair (sessions partagées : fiches, événements,
// relecture) et ce qu'on applique de ce qu'il envoie (sessions de sa machine virtuelle, dans le registre).
import type { Logger } from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import { TAILLE_HISTORIQUE_DUO, type MessageLien, type NiveauPartage } from '../../commun/duo.ts';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Registre } from '../registre/registre.ts';
import { niveauPour, type PartagesDuo } from './partages.ts';

type FicheDuo = { fiche: ResumeSession; niveau: NiveauPartage };

export class Synchro {
  // Sessions annoncées au pair par le dernier instantané : une suppression de l'une d'elles le ré-annonce.
  private annoncees = new Set<string>();

  constructor(
    private readonly registre: Registre,
    private readonly diffusion: Diffusion,
    private readonly partages: PartagesDuo,
    private readonly journal: Logger,
  ) {}

  // ---- Émission -----------------------------------------------------------------------------------------------

  /** Les sessions partagées de ce relais : envoyées à chaque (re)connexion et à chaque changement de partage. */
  instantane(): MessageLien {
    const liste = this.partagees();
    this.annoncees = new Set(liste.map((x) => x.fiche.id));
    return { type: 'partage', sessions: liste };
  }

  /** Ce qu'un message interne devient sur le lien, s'il concerne une session partagée ; null sinon. */
  versLien(m: MessageClient): MessageLien | null {
    if (m.type === 'session') return this.versLienFiche(m.session);
    if (m.type === 'evenement') return this.versLienEvenement(m.evenement);
    if (m.type === 'supprimee' && this.annoncees.has(m.id)) return this.instantane();
    return null;
  }

  /** Relecture demandée par le pair : les derniers événements d'une session partagée avec lui. */
  relecture(sessionId: string): MessageLien | null {
    if (!this.partagee(sessionId)) return null;
    const evenements = this.registre
      .derniersEvenements(sessionId, TAILLE_HISTORIQUE_DUO)
      .map((e) => ({ ts: e.ts, evt: e.evt }));
    return { type: 'historique', sessionId, evenements };
  }

  // ---- Réception ----------------------------------------------------------------------------------------------

  /** Applique l'instantané du pair ; rend les sessions à relire (toutes celles de l'instantané). */
  appliquerInstantane(nom: string, sessions: readonly FicheDuo[]): string[] {
    const recues = new Set<string>();
    for (const { fiche, niveau } of sessions) {
      if (this.importer(nom, fiche, niveau)) recues.add(fiche.id);
    }
    for (const s of this.registre.sessions(true)) {
      if (s.duo?.pair === nom && !recues.has(s.id)) this.supprimer(s.id);
    }
    return [...recues];
  }

  appliquerFiche(nom: string, { fiche, niveau }: FicheDuo): void {
    this.importer(nom, fiche, niveau);
  }

  appliquerEvenement(nom: string, sessionId: string, ts: string, evt: Evenement): void {
    if (!this.appartientAu(sessionId, nom)) return;
    const evenement = this.registre.ajouterEvenement(sessionId, ts, evt);
    this.diffusion.diffuser({ type: 'evenement', evenement });
  }

  /** Remplace le fil d'une session du pair par la relecture reçue (idempotent : une relecture ne double rien). */
  appliquerRelecture(nom: string, sessionId: string, evenements: readonly { ts: string; evt: Evenement }[]): void {
    if (!this.appartientAu(sessionId, nom)) return;
    this.registre.purgerEvenements([sessionId]);
    this.registre.ajouterHistorique(sessionId, evenements);
    this.diffusion.diffuser({ type: 'fil_modifie', sessionId });
  }

  /** Retire toutes les sessions reçues de ce pair (révocation, déconnexion définitive). */
  retirerPair(nom: string): void {
    for (const s of this.registre.sessions(true)) {
      if (s.duo?.pair === nom) this.supprimer(s.id);
    }
  }

  /** Vrai si la session est partagée avec ce pair et que le relais ne l'a pas reçue d'un pair. */
  partagee(sessionId: string): boolean {
    const s = this.registre.session(sessionId);
    return s !== null && !s.duo && niveauPour(s, this.partages.lister()) !== null;
  }

  // ---- Privé -------------------------------------------------------------------------------------------------

  private partagees(): FicheDuo[] {
    const partages = this.partages.lister();
    const liste: FicheDuo[] = [];
    for (const fiche of this.registre.sessions(false)) {
      if (fiche.duo) continue;
      const niveau = niveauPour(fiche, partages);
      if (niveau) liste.push({ fiche, niveau });
    }
    return liste;
  }

  private versLienFiche(fiche: ResumeSession): MessageLien | null {
    if (fiche.duo) return null;
    if (fiche.archivee) return this.annoncees.has(fiche.id) ? this.instantane() : null;
    const niveau = niveauPour(fiche, this.partages.lister());
    if (!niveau) return this.annoncees.has(fiche.id) ? this.instantane() : null;
    return { type: 'fiche', fiche, niveau };
  }

  private versLienEvenement(e: { sessionId: string; ts: string; evt: Evenement }): MessageLien | null {
    if (!this.partagee(e.sessionId)) return null;
    return { type: 'evenement', sessionId: e.sessionId, ts: e.ts, evt: e.evt };
  }

  // Une session du pair n'écrase jamais une session locale de même identifiant.
  private importer(nom: string, fiche: ResumeSession, niveau: NiveauPartage): boolean {
    const existante = this.registre.session(fiche.id);
    if (existante && existante.duo?.pair !== nom) {
      this.journal.warn({ sessionId: fiche.id }, 'session du pair ignorée : identifiant déjà local');
      return false;
    }
    const vue: ResumeSession = {
      ...fiche,
      machine: nom,
      projet: { ...fiche.projet, machine: nom },
      duo: { pair: nom, niveau },
    };
    this.registre.enregistrerSession(vue);
    this.diffusion.diffuser({ type: 'session', session: this.registre.session(fiche.id) ?? vue });
    return true;
  }

  private appartientAu(sessionId: string, nom: string): boolean {
    return this.registre.session(sessionId)?.duo?.pair === nom;
  }

  private supprimer(id: string): void {
    this.registre.supprimerSession(id);
    this.diffusion.diffuser({ type: 'supprimee', id });
  }
}
