// Responsabilité : l'état partagé d'une session SDK (fiche, requête vivante, file de messages, bilan du tour, drapeaux)
// et ses primitives — émission vers le fil, mise à jour de la fiche, file de messages, clôture de la requête. Les
// modules session-sdk-*.ts y travaillent sans le posséder ; session-sdk.ts en est la façade.
import { query as requeteParDefaut, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { PiecesPreparees } from '../presentation/pieces.ts';
import { PresentationSession } from '../presentation/session-presentation.ts';
import { AvisSdk } from './avis-sdk.ts';
import { BilanTour } from './bilan-tour.ts';
import { stockeurImages } from './historique.ts';
import { FileAsynchrone, messageUtilisateur } from './file-messages-sdk.ts';
import type { SessionPersistee } from './persistance.ts';
import type { EnvironnementSdk, FabriqueRequete, RequeteSdk, TraductionSdk } from './session-sdk.ts';
import { ReglagesVivants } from './session-sdk-vivante.ts';
import { SuiviNuit } from './suivi-nuit.ts';
import { SuiviTranscript } from './suivi-transcript.ts';
import { RegistreTaches } from './taches-sdk.ts';
import { nouvelEtatTraduction, traduireSdk } from './traduction-sdk.ts';

const DELAI_MCP_MS = 15_000;
const PERIODE_MCP_MS = 250;
const TRADUCTION_PAR_DEFAUT: TraductionSdk = { nouvelEtat: nouvelEtatTraduction, traduire: traduireSdk };

// État d'une session SDK : mutable, partagé par référence entre la façade et ses modules.
export interface NoyauSdk {
  readonly p: SessionPersistee;
  readonly env: EnvironnementSdk;
  readonly avis: AvisSdk;
  readonly fabrique: FabriqueRequete;
  readonly traduction: TraductionSdk;
  readonly delaiMcp: number;
  readonly periodeMcp: number;
  readonly suivi: SuiviTranscript; // relecture du transcript quand il grossit (voir suivi-transcript.ts)
  readonly suiviNuit: SuiviNuit;
  readonly presentation: PresentationSession | null;
  readonly registreTaches: RegistreTaches;
  readonly reglagesVivants: ReglagesVivants;
  readonly identifiantsSdk: string[]; // identifiants SDK de la fiche (anciens et courant), persistés
  etat: ResumeSession;
  requete: RequeteSdk | null;
  fil: FileAsynchrone<SDKUserMessage> | null;
  bilan: BilanTour;
  aReprendre: boolean; // à reprendre au démarrage du poste (voir persistance.ts)
  historiqueEmis: boolean; // l'historique du transcript n'est envoyé qu'à l'ouverture de la fiche
  pointReprise: string | null; // rembobinage en attente : la prochaine reprise part de cette entrée
  identifiantNeuf: string | null; // conversation recommencée après le rembobinage du premier message
  interrompuParChris: boolean; // le SDK coupe le flux par une erreur après une interruption : pas une panne
  cessionEnAttente: boolean; // conversation tenue ailleurs pendant un tour : la requête se ferme en fin de tour
}

export function creerNoyau(
  p: SessionPersistee,
  env: EnvironnementSdk,
  colle: (texte: string) => Promise<string | null>,
): NoyauSdk {
  const n: NoyauSdk = {
    p,
    env,
    avis: new AvisSdk({ emettre: (evt) => emettre(n, evt), maj: (champs) => maj(n, champs) }),
    fabrique: env.requete ?? requeteParDefaut,
    traduction: env.traduction ?? TRADUCTION_PAR_DEFAUT,
    delaiMcp: env.delaiMcpMs ?? DELAI_MCP_MS,
    periodeMcp: env.periodeMcpMs ?? PERIODE_MCP_MS,
    identifiantsSdk: [...(p.identifiants ?? [])],
    etat: etatInitial(p),
    requete: null,
    fil: null,
    bilan: new BilanTour(),
    aReprendre: p.aReprendre,
    historiqueEmis: false,
    pointReprise: null,
    identifiantNeuf: null,
    interrompuParChris: false,
    cessionEnAttente: false,
    reglagesVivants: new ReglagesVivants(() => n.requete, env.journal, p.resume.id),
    registreTaches: new RegistreTaches(),
    suivi: suiviDe(env, p, () => n),
    presentation: presentationDe(env, p, () => n),
    suiviNuit: suiviNuitDe(() => n, colle),
  };
  return n;
}

// La fiche d'une session persistée est reprenable au démarrage du poste, sinon fermée : aucune requête ne vit encore.
function etatInitial(p: SessionPersistee): ResumeSession {
  return {
    ...p.resume,
    statut: p.aReprendre ? p.resume.statut : 'fermee',
    dialogue: null,
    tmux: null,
    attachee: false,
    moteur: 'sdk',
  };
}

// Les accesseurs `() => n` sont lus plus tard, au moment des événements : l'objet n'existe pas encore à la
// construction.
function suiviDe(env: EnvironnementSdk, p: SessionPersistee, n: () => NoyauSdk): SuiviTranscript {
  const stockage = env.presentation?.stockage;
  return new SuiviTranscript({
    journal: env.journal,
    emettre: (evenements, direct) => env.sortie.historique?.(n().etat.id, evenements, direct),
    ...(env.relectureRecenteMs !== undefined ? { recentMs: env.relectureRecenteMs } : {}),
    ...(stockage ? { stockerImage: stockeurImages(stockage, p.resume.id, env.journal) } : {}),
  });
}

function presentationDe(env: EnvironnementSdk, p: SessionPersistee, n: () => NoyauSdk): PresentationSession | null {
  const pres = env.presentation;
  if (!pres) return null;
  return new PresentationSession({
    sessionId: p.resume.id,
    cwd: p.resume.cwd,
    racines: pres.racines,
    stockage: pres.stockage,
    emettre: (evt) => emettre(n(), evt),
    renommer: (titre) => maj(n(), { titre }),
    journal: env.journal,
    ...(pres.api ? { api: pres.api } : {}),
    ...(pres.relais ? { relais: pres.relais } : {}),
  });
}

function suiviNuitDe(n: () => NoyauSdk, colle: (texte: string) => Promise<string | null>): SuiviNuit {
  return new SuiviNuit({
    resume: () => n().etat,
    messagesChrisEnVol: () => n().bilan.enVol,
    publierNuit: (nuit) => maj(n(), { nuit }),
    emettre: (evt) => emettre(n(), evt),
    coller: colle,
    journal: () => n().env.journal,
    peutEcrire: () => n().requete !== null && n().fil !== null,
  });
}

// L'activité d'une session est son fil (et le début d'un tour) : une reprise, un réglage ou un titre ne la datent pas.
export function emettre(n: NoyauSdk, evt: Evenement): void {
  if (evt.type !== 'flux') n.etat = { ...n.etat, majLe: new Date().toISOString() };
  n.env.sortie.evenement(n.etat.id, evt);
}

export function maj(n: NoyauSdk, champs: Partial<ResumeSession>): void {
  const activite = champs.statut === 'travail';
  n.etat = { ...n.etat, ...champs, majLe: activite ? new Date().toISOString() : n.etat.majLe };
  n.env.sortie.resume(n.etat);
}

export function memoriser(n: NoyauSdk, id: string | null): void {
  if (id && !n.identifiantsSdk.includes(id)) n.identifiantsSdk.push(id);
}

// Un message poussé au SDK (Chris, relance, compaction, réveil) ouvre un tour que le bilan compte.
export function pousser(
  n: NoyauSdk,
  texte: string,
  blocs?: PiecesPreparees['blocs'],
  uuid?: SDKUserMessage['uuid'],
  priorite?: SDKUserMessage['priority'],
): void {
  n.interrompuParChris = false;
  if (!n.fil) return;
  n.fil.push(messageUtilisateur(texte, blocs, uuid, priorite));
  n.bilan.envoye();
}

// Fichiers touchés par le tour, juste avant `tour_fini` (ou à la fin d'un tour interrompu, sans `tour_fini`).
export function clorTour(n: NoyauSdk): void {
  const tour = n.env.tours?.finirTour();
  if (tour) emettre(n, { type: 'fichiers_tour', tour: tour.tour, fichiers: tour.fichiers });
}

export function libererRequete(n: NoyauSdk, message: string): void {
  clorTour(n);
  n.avis.refuserTous(message, true);
  n.requete = null;
  n.fil?.clore();
  n.fil = null;
}
