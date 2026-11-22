// Responsabilité : le protocole chiffré entre nœuds une fois le lien ouvert. Côté qui tient une session : instantané,
// fil, écriture, interruption, ouverture, abonnement au fil en direct. Côté qui la consulte : requêtes corrélées par
// référence, instantanés et événements reçus dans le cache mémoire. Les sessions du nœud se lisent dans le registre et
// ne s'écrivent jamais ailleurs.
import type { Logger } from 'pino';
import {
  NOMBRE_MAX_ABONNEMENTS,
  TAILLE_FIL_FEDERE,
  TAILLE_MAX_CLAIR_OCTETS,
  DELAI_REPONSE_FEDEREE_MS,
  type EvenementFedere,
  type GesteFedere,
  type MachineAnnoncee,
  type MessageChiffre,
} from '../../commun/federation.ts';
import { reponseGeste } from './gestes.ts';

const DESCRIPTION_LOCALE = 'Cet ordinateur';
import type { OuvertureChezProprietaire } from '../duo/pont-sessions.ts';
import type { Evenement } from '../../commun/session.ts';
import type { Registre } from '../registre/registre.ts';
import type { CanalNoeud } from './canal.ts';
import { CacheDistant } from './distant.ts';
import { nonceRef } from './identifiants.ts';

/** Ce que le nœud fait pour un pair au nom de son propriétaire : mêmes chemins qu'un geste local. */
export interface PontFederation {
  ouvrir(demande: OuvertureChezProprietaire): Promise<Response>;
  envoyer(session: string, texte: string): Promise<Response>;
  interrompre(session: string): Promise<Response>;
  /** Un geste relayé (liste fermée), exécuté par la route locale correspondante, sans autre contrôle d'accès. */
  geste?(geste: GesteLocal): Promise<Response>;
}

export interface GesteLocal {
  readonly geste: GesteFedere;
  readonly methode: 'GET' | 'POST';
  readonly session?: string;
  readonly requete?: string;
  readonly corps?: string;
}

export interface OptionsEchanges {
  readonly registre: Registre;
  readonly pont: PontFederation;
  readonly machine: string;
  readonly nom: () => string;
  readonly distant: CacheDistant;
  readonly journal: Logger;
  readonly delaiReponseMs?: number;
}

type Attente = (m: MessageChiffre) => void;

export class Echanges {
  private readonly attentes = new Map<string, Attente>();
  private readonly abonnements = new Map<string, Set<string>>();

  constructor(private readonly options: OptionsEchanges) {}

  /** L'instantané des sessions du nœud, ajusté pour tenir dans une trame. */
  instantane(): MessageChiffre {
    const sessions = this.options.registre.sessions(false).filter((s) => !s.duo);
    const vue = this.machineAnnoncee();
    return tenirDansLaLimite(sessions, (liste) => ({
      t: 'instantane',
      machine: this.options.machine,
      nom: this.options.nom(),
      sessions: [...liste],
      ...(vue ? { vue } : {}),
    }));
  }

  private machineAnnoncee(): MachineAnnoncee | null {
    const fiche = this.options.registre.machines().find((m) => m.id === this.options.machine);
    if (!fiche) return null;
    return {
      // « Cet ordinateur » ne veut rien dire chez un pair : il voit le nom du nœud à la place.
      description: (fiche.description === DESCRIPTION_LOCALE ? this.options.nom() : fiche.description).slice(0, 200),
      racines: fiche.racines.slice(0, 50),
      projets: fiche.projets.slice(0, 500),
      comptes: fiche.comptes.slice(0, 20),
    };
  }

  /** Un événement local d'une session : envoyé en direct aux canaux dont le pair suit le fil de cette session. */
  diffuserEvenement(session: string, seq: number, ts: string, evt: Evenement, canaux: readonly CanalNoeud[]): void {
    for (const canal of canaux) {
      if (this.abonnements.get(canal.membre)?.has(session)) canal.envoyer({ t: 'evenement', session, seq, ts, evt });
    }
  }

  /** Oublie les abonnements d'un pair (canal fermé ou révoqué). */
  oublier(membre: string): void {
    this.abonnements.delete(membre);
  }

  /** Une requête entrante ou une réponse d'un pair, sur un lien ouvert. */
  async traiter(canal: CanalNoeud, message: MessageChiffre): Promise<void> {
    switch (message.t) {
      case 'instantane':
        return this.options.distant.instantane(
          canal.membre,
          message.machine,
          message.nom,
          message.sessions,
          message.vue ?? null,
        );
      case 'evenement':
        return this.options.distant.ajouterEvenement(canal.membre, message.session, {
          ...(message.seq !== undefined ? { seq: message.seq } : {}),
          ts: message.ts,
          evt: message.evt,
        });
      case 'fil':
        return this.repondreFil(canal, message.ref, message.session);
      case 'ecrire':
        return this.repondreEcriture(canal, message.ref, message.session, message.texte);
      case 'interrompre':
        return this.repondreInterruption(canal, message.ref, message.session);
      case 'ouvrir':
        return this.repondreOuverture(canal, message.ref, message.machine, message.chemin, message.message);
      case 'fil_reponse':
        return this.recevoirFil(canal, message.ref, message.session, message.evenements);
      case 'geste':
        return this.repondreGeste(canal, message);
      case 'reponse':
      case 'geste_reponse':
        return this.attentes.get(message.ref)?.(message);
      default:
        return undefined;
    }
  }

  /** Envoie une requête à un pair et rend sa réponse (ou null : hors ligne, trame trop grande, délai dépassé). */
  requeter(
    canal: CanalNoeud,
    construire: (ref: string) => MessageChiffre,
    delaiMs?: number,
  ): Promise<MessageChiffre | null> {
    const ref = nonceRef();
    return new Promise((resoudre) => {
      const fin = (m: MessageChiffre | null): void => {
        clearTimeout(minuterie);
        this.attentes.delete(ref);
        resoudre(m);
      };
      const minuterie = setTimeout(() => fin(null), delaiMs ?? this.options.delaiReponseMs ?? DELAI_REPONSE_FEDEREE_MS);
      this.attentes.set(ref, fin);
      if (!canal.envoyer(construire(ref))) fin(null);
    });
  }

  // ---- Côté qui tient la session ------------------------------------------------------------------------------

  private sessionPartagee(session: string): boolean {
    const fiche = this.options.registre.session(session);
    return fiche !== null && !fiche.duo;
  }

  private repondreFil(canal: CanalNoeud, ref: string, session: string): void {
    if (!this.sessionPartagee(session)) return this.reponse(canal, ref, false, 'session inconnue');
    this.abonner(canal.membre, session);
    const evenements = this.options.registre
      .derniersEvenements(session, TAILLE_FIL_FEDERE)
      .map((e) => ({ seq: e.seq, ts: e.ts, evt: e.evt }));
    const message = tenirDansLaLimite(evenements, (liste) => ({
      t: 'fil_reponse',
      ref,
      session,
      evenements: [...liste],
    }));
    canal.envoyer(message);
  }

  private abonner(membre: string, session: string): void {
    const suivies = this.abonnements.get(membre) ?? new Set<string>();
    if (suivies.size >= NOMBRE_MAX_ABONNEMENTS && !suivies.has(session)) return;
    suivies.add(session);
    this.abonnements.set(membre, suivies);
  }

  private async repondreEcriture(canal: CanalNoeud, ref: string, session: string, texte: string): Promise<void> {
    if (!this.sessionPartagee(session)) return this.reponse(canal, ref, false, 'session inconnue');
    const r = await lireBilan(await this.options.pont.envoyer(session, texte));
    this.reponse(canal, ref, r.ok, r.raison);
  }

  private async repondreInterruption(canal: CanalNoeud, ref: string, session: string): Promise<void> {
    if (!this.sessionPartagee(session)) return this.reponse(canal, ref, false, 'session inconnue');
    const r = await lireBilan(await this.options.pont.interrompre(session));
    this.reponse(canal, ref, r.ok, r.raison);
  }

  private async repondreOuverture(
    canal: CanalNoeud,
    ref: string,
    machine: string,
    chemin: string,
    message: string,
  ): Promise<void> {
    if (machine !== this.options.machine) return this.reponse(canal, ref, false, 'machine inconnue');
    const nom = chemin.split('/').filter(Boolean).pop() ?? chemin;
    const demande: OuvertureChezProprietaire = {
      machine,
      projet: { machine, chemin, nom },
      message,
      autonomie: false,
      mode: 'default',
    };
    const r = await lireBilan(await this.options.pont.ouvrir(demande));
    if (!r.ok) return this.reponse(canal, ref, false, r.raison);
    const id = r.corps && typeof r.corps === 'object' && 'id' in r.corps ? String(r.corps.id) : undefined;
    this.reponse(canal, ref, id !== undefined, id === undefined ? 'session ouverte sans identifiant' : undefined, id);
  }

  // Un geste relayé par un pair : sa session doit être une des nôtres (pas reçue du duo) ; `ouvrir` vise une machine du
  // parc de ce nœud. Lire le fil abonne le pair au direct, comme `fil`.
  private async repondreGeste(canal: CanalNoeud, m: Extract<MessageChiffre, { t: 'geste' }>): Promise<void> {
    const refuser = (statut: number, texte: string): void =>
      void canal.envoyer({ t: 'geste_reponse', ref: m.ref, statut, corps: JSON.stringify({ erreur: texte }) });
    const pont = this.options.pont.geste;
    if (!pont) return refuser(501, 'geste non pris en charge par ce nœud');
    if (m.geste !== 'ouvrir' && (!m.session || !this.sessionPartagee(m.session))) {
      return refuser(404, 'session inconnue');
    }
    if (m.geste === 'evenements' && m.session) this.abonner(canal.membre, m.session);
    try {
      const reponse = await pont({ ...m });
      canal.envoyer({ t: 'geste_reponse', ref: m.ref, ...(await reponseGeste(reponse, m.geste)) });
    } catch (erreur) {
      this.options.journal.error({ err: erreur, geste: m.geste }, 'geste relayé en échec');
      refuser(500, 'geste en échec sur le nœud');
    }
  }

  private reponse(canal: CanalNoeud, ref: string, ok: boolean, raison?: string, session?: string): void {
    canal.envoyer({
      t: 'reponse',
      ref,
      ok,
      ...(raison !== undefined ? { raison } : {}),
      ...(session !== undefined ? { session } : {}),
    });
  }

  // ---- Côté qui consulte --------------------------------------------------------------------------------------

  private recevoirFil(canal: CanalNoeud, ref: string, session: string, evenements: readonly EvenementFedere[]): void {
    this.options.distant.remplacerFil(canal.membre, session, evenements);
    this.attentes.get(ref)?.({ t: 'fil_reponse', ref, session, evenements: [...evenements] });
  }
}

/** Réduit une liste (les plus anciens d'abord) jusqu'à ce que le message tienne dans la limite d'une trame. */
export function tenirDansLaLimite<T>(
  liste: readonly T[],
  construire: (liste: readonly T[]) => MessageChiffre,
): MessageChiffre {
  let courante = liste;
  let message = construire(courante);
  while (taille(message) > TAILLE_MAX_CLAIR_OCTETS && courante.length > 0) {
    courante = courante.slice(Math.max(1, Math.ceil(courante.length / 10)));
    message = construire(courante);
  }
  return message;
}

function taille(message: MessageChiffre): number {
  return new TextEncoder().encode(JSON.stringify(message)).byteLength;
}

interface Bilan {
  readonly ok: boolean;
  readonly raison?: string;
  readonly corps?: unknown;
}

/** Relit la réponse HTTP d'un geste local : statut, motif d'erreur, corps. */
async function lireBilan(reponse: Response): Promise<Bilan> {
  const corps: unknown = await reponse.json().catch(() => null);
  if (reponse.ok) return { ok: true, corps };
  const erreur =
    corps && typeof corps === 'object' && 'erreur' in corps ? String(corps.erreur) : `refus ${reponse.status}`;
  return { ok: false, raison: erreur };
}
