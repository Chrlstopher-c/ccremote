// Responsabilité : la salle de réunion du relais — crée ou poursuit une réunion, choisit les destinataires, relaie la
// demande de Chris par la commande « envoyer » du poste (le même chemin qu'un message ordinaire), et recopie les
// réponses des sessions. Les sous-agents n'ont pas de fiche : ils ne peuvent jamais être destinataires.
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import {
  AUTEUR_CHRIS,
  type DemandeReunion,
  type EnvoiReunion,
  type ReponseReunion,
  type Reunion,
} from '../../commun/reunion.ts';
import type { Evenement } from '../../commun/session.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import { choisirAuto, type RouteurAuto } from './destinataires.ts';
import { cumulerReponse, enveloppeDemande, sujetDepuis } from './messages.ts';
import type { RegistreReunions } from './registre-reunions.ts';

export type Resultat<T> =
  | { readonly ok: true; readonly valeur: T }
  | { readonly ok: false; readonly statut: number; readonly erreur: string };

export interface DependancesSalle {
  readonly reunions: RegistreReunions;
  readonly registre: Pick<Registre, 'session' | 'sessions'>;
  readonly postes: Pick<Postes, 'commander'>;
  readonly diffusion: Pick<Diffusion, 'diffuser'>;
  readonly journal: Logger;
  readonly limite: number; // demandes de Chris relayées par réunion
  readonly routeur?: RouteurAuto; // absent : routage par pertinence (pur)
}

interface Tour {
  readonly reunionId: string;
  readonly messageId: string;
  texte: string;
}

interface Choix {
  readonly cibles: string[];
  readonly refus: EnvoiReunion[];
}

const LISTE_MAX = 50;

function echec(statut: number, erreur: string): Resultat<never> {
  return { ok: false, statut, erreur };
}

function maintenant(): string {
  return new Date().toISOString();
}

function demandesDe(reunion: Reunion): number {
  return reunion.messages.filter((m) => m.auteur === AUTEUR_CHRIS).length;
}

export class SalleDeReunion {
  // Demande relayée dont la réponse n'est pas close : sessionId → réunion qui l'attend.
  private readonly attentes = new Map<string, string>();
  // Tour de réponse en cours : ses textes successifs s'accumulent dans un seul message de la réunion.
  private readonly tours = new Map<string, Tour>();

  constructor(private readonly d: DependancesSalle) {}

  lister(): Reunion[] {
    return this.d.reunions.lister(LISTE_MAX);
  }

  ouvrir(id: string): Reunion | null {
    return this.d.reunions.lire(id);
  }

  async demander(demande: DemandeReunion): Promise<Resultat<ReponseReunion>> {
    const existante = demande.reunionId === undefined ? null : this.d.reunions.lire(demande.reunionId);
    if (demande.reunionId !== undefined && !existante) return echec(404, 'réunion inconnue');
    if (existante && demandesDe(existante) >= this.d.limite) {
      return echec(429, `limite de ${this.d.limite} demandes atteinte pour cette réunion`);
    }
    const choix = this.choisir(demande);
    if (!choix.ok) return choix;
    return this.relayer(demande, existante, choix.valeur);
  }

  // Appelé pour chaque événement d'un poste. Seul le fil principal d'une session dont la demande est en attente compte.
  observer(sessionId: string, evt: Evenement): void {
    if (evt.type === 'tour_fini' || evt.type === 'erreur') {
      this.attentes.delete(sessionId);
      this.tours.delete(sessionId);
      return;
    }
    if (evt.type !== 'texte' || evt.agent !== undefined) return;
    const reunionId = this.attentes.get(sessionId);
    if (reunionId !== undefined) this.recopier(sessionId, reunionId, evt.texte);
  }

  private async relayer(
    demande: DemandeReunion,
    existante: Reunion | null,
    choix: Choix,
  ): Promise<Resultat<ReponseReunion>> {
    const sujet = existante?.sujet ?? sujetDepuis(demande.texte);
    const reunionId = existante?.id ?? this.creer(sujet);
    this.d.reunions.ajouterMessage(reunionId, {
      id: randomUUID(),
      auteur: AUTEUR_CHRIS,
      texte: demande.texte,
      ts: maintenant(),
      destinataires: choix.cibles,
    });
    this.d.reunions.ajouterParticipants(reunionId, choix.cibles);
    // Avant l'envoi : la réponse peut précéder l'accusé du poste.
    for (const id of choix.cibles) this.attentes.set(id, reunionId);
    const contenu = enveloppeDemande(sujet, demande.texte);
    const envoyes = await Promise.all(choix.cibles.map((id) => this.envoyerA(id, contenu)));
    for (const envoi of envoyes) if (!envoi.ok) this.attentes.delete(envoi.sessionId);
    const reunion = this.d.reunions.lire(reunionId);
    if (!reunion) return echec(500, 'réunion introuvable après envoi');
    this.diffuser(reunion);
    return { ok: true, valeur: { reunion, envois: [...choix.refus, ...envoyes] } };
  }

  private choisir(demande: DemandeReunion): Resultat<Choix> {
    const { destinataires } = demande;
    const choix: Choix =
      destinataires === 'auto'
        ? { cibles: choisirAuto(demande.texte, this.d.registre.sessions(), this.d.routeur), refus: [] }
        : this.resoudre(destinataires);
    if (choix.cibles.length > 0) return { ok: true, valeur: choix };
    return echec(409, destinataires === 'auto' ? 'aucune session active' : 'aucune session destinataire joignable');
  }

  // Chris a choisi ses destinataires : une session inconnue, fermée ou rangée est signalée, pas relayée.
  private resoudre(ids: readonly string[]): Choix {
    const cibles: string[] = [];
    const refus: EnvoiReunion[] = [];
    for (const sessionId of new Set(ids)) {
      const session = this.d.registre.session(sessionId);
      if (!session) refus.push({ sessionId, ok: false, erreur: 'session inconnue' });
      else if (session.statut === 'fermee' || session.archivee) {
        refus.push({ sessionId, ok: false, erreur: 'session fermée ou rangée' });
      } else cibles.push(sessionId);
    }
    return { cibles, refus };
  }

  private async envoyerA(sessionId: string, contenu: string): Promise<EnvoiReunion> {
    const session = this.d.registre.session(sessionId);
    if (!session) return { sessionId, ok: false, erreur: 'session inconnue' };
    const reponse = await this.d.postes.commander(session.machine, { kind: 'envoyer', sessionId, texte: contenu });
    if (reponse.ok) return { sessionId, ok: true };
    this.d.journal.warn({ sessionId, erreur: reponse.erreur }, 'demande de réunion refusée par le poste');
    return { sessionId, ok: false, erreur: reponse.erreur ?? 'envoi refusé' };
  }

  private recopier(sessionId: string, reunionId: string, texte: string): void {
    try {
      const tour = this.tours.get(sessionId);
      if (tour?.reunionId === reunionId) this.completer(tour, texte);
      else this.ouvrirTour(sessionId, reunionId, texte);
      const reunion = this.d.reunions.lire(reunionId);
      if (reunion) this.diffuser(reunion);
    } catch (erreur) {
      this.d.journal.error({ err: erreur, sessionId, reunionId }, 'réponse non recopiée dans la réunion');
    }
  }

  private completer(tour: Tour, ajout: string): void {
    tour.texte = cumulerReponse(tour.texte, ajout);
    this.d.reunions.majTexte(tour.messageId, tour.texte);
  }

  private ouvrirTour(sessionId: string, reunionId: string, texte: string): void {
    const messageId = randomUUID();
    const contenu = cumulerReponse(null, texte);
    this.d.reunions.ajouterMessage(reunionId, {
      id: messageId,
      auteur: sessionId,
      texte: contenu,
      ts: maintenant(),
      destinataires: [],
    });
    this.tours.set(sessionId, { reunionId, messageId, texte: contenu });
  }

  private creer(sujet: string): string {
    const id = randomUUID();
    this.d.reunions.creer({ id, sujet, creeLe: maintenant() });
    return id;
  }

  private diffuser(reunion: Reunion): void {
    this.d.diffusion.diffuser({ type: 'reunion', reunion });
  }
}
