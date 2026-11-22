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
  type MessageChiffre,
} from '../../commun/federation.ts';
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
    return tenirDansLaLimite(sessions, (liste) => ({
      t: 'instantane',
      machine: this.options.machine,
      nom: this.options.nom(),
      sessions: [...liste],
    }));
  }

  /** Un événement local d'une session : envoyé en direct aux canaux dont le pair suit le fil de cette session. */
  diffuserEvenement(session: string, ts: string, evt: Evenement, canaux: readonly CanalNoeud[]): void {
    for (const canal of canaux) {
      if (this.abonnements.get(canal.membre)?.has(session)) canal.envoyer({ t: 'evenement', session, ts, evt });
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
        return this.options.distant.instantane(canal.membre, message.machine, message.nom, message.sessions);
      case 'evenement':
        return this.options.distant.ajouterEvenement(canal.membre, message.session, {
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
      case 'reponse':
        return this.attentes.get(message.ref)?.(message);
      default:
        return undefined;
    }
  }

  /** Envoie une requête à un pair et rend sa réponse (ou null : hors ligne, trame trop grande, délai dépassé). */
  requeter(canal: CanalNoeud, construire: (ref: string) => MessageChiffre): Promise<MessageChiffre | null> {
    const ref = nonceRef();
    return new Promise((resoudre) => {
      const fin = (m: MessageChiffre | null): void => {
        clearTimeout(minuterie);
        this.attentes.delete(ref);
        resoudre(m);
      };
      const minuterie = setTimeout(() => fin(null), this.options.delaiReponseMs ?? DELAI_REPONSE_FEDEREE_MS);
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
      .map((e) => ({ ts: e.ts, evt: e.evt }));
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
