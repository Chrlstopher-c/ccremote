// Responsabilité : les contrats du mode duo (deux relais reliés) — appairage, partage, messages du lien entre relais et
// état vu par les clients. Aucune logique : les décisions sont dans relais/duo/.
import { z } from 'zod';
import { FenetreUsage } from './comptes.ts';
import { TAILLE_MAX_TEXTE_SESSION } from './fichiers-session.ts';
import { NOMBRE_MAX_PIECES, PieceJointe } from './presentation.ts';
import {
  EtatServeur,
  FICHIERS_MAX_MODULE,
  FichierModule,
  IdModule,
  ManifesteModule,
  ReponseServeur,
  RequeteServeur,
} from './modules.ts';
import { Evenement, ResumeSession } from './session.ts';

export const ALPHABET_CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I/L : lisible à la voix
export const LONGUEUR_CODE = 8;
export const DUREE_CODE_MS = 10 * 60 * 1000;
export const ESSAIS_CODE_MAX = 5; // au-delà, le code est brûlé
export const TAILLE_HISTORIQUE_DUO = 200; // événements renvoyés par la relecture d'une session partagée
export const DUREE_DEMANDE_MS = 10 * 60 * 1000; // une demande du pair sans réponse de Chris est refusée
export const DELAI_MARGE_REPONSE_MS = 30_000; // marge du demandeur au-delà du délai de la demande
export const DUREE_CONFLIT_MS = 30 * 60 * 1000; // une alerte de fichier n'est redite qu'après ce délai
export const PREFIXE_MODULE_DUO = 'duo:'; // machine d'un module reçu du pair : `duo:<utilisateur>`
export const NOMBRE_MAX_MESSAGES_PAQUET = 3;
export const TAILLE_MAX_BILAN_PAQUET = 1500; // caractères du dernier texte de Claude repris dans le paquet

export const NiveauPartage = z.enum(['lecture', 'ecriture']);
export type NiveauPartage = z.infer<typeof NiveauPartage>;
export const GenrePartage = z.enum(['session', 'projet']);
export type GenrePartage = z.infer<typeof GenrePartage>;

export const CorpsRejoindre = z.object({
  adresse: z.string().min(3).max(255), // hôte:port du relais du pair, tel qu'affiché chez lui
  code: z.string().length(LONGUEUR_CODE),
});
export const CorpsPartage = z.object({
  cible: z.string().min(1).max(2048), // identifiant de session, ou chemin du projet
  genre: GenrePartage,
  niveau: NiveauPartage,
});
export const CorpsPresence = z.object({ session: z.string().min(1).max(200), present: z.boolean() });
export type CorpsRejoindre = z.infer<typeof CorpsRejoindre>;
export type CorpsPartage = z.infer<typeof CorpsPartage>;
export type CorpsPresence = z.infer<typeof CorpsPresence>;

export const PartageDuo = z.object({
  cible: z.string(),
  genre: GenrePartage,
  niveau: NiveauPartage,
  creeLe: z.string(),
});
export type PartageDuo = z.infer<typeof PartageDuo>;

export const CorpsNom = z.object({ nom: z.string().trim().max(40) }); // vide : retour au nom d'utilisateur
export type CorpsNom = z.infer<typeof CorpsNom>;

export const EtatDuo = z.object({
  utilisateur: z.string(), // nom d'utilisateur de ce relais (machine)
  nom: z.string(), // nom affiché de ce relais, annoncé au pair
  ecoute: z.string(), // hôte:port où le pair peut se relier à ce relais
  pair: z.object({ utilisateur: z.string(), nom: z.string(), adresse: z.string().nullable() }).nullable(),
  // absent : non appairé · connecte : lien authentifié · hors_ligne : appairé, lien coupé · refuse : clé rejetée
  etat: z.enum(['absent', 'connecte', 'hors_ligne', 'refuse']),
  partages: z.array(PartageDuo),
  presences: z.array(z.string()), // sessions partagées ouvertes chez le pair
});
export type EtatDuo = z.infer<typeof EtatDuo>;

export const GenreDemande = z.enum(['message', 'ouvrir_session', 'passer_la_main']);
export type GenreDemande = z.infer<typeof GenreDemande>;
export const DemandeDuo = z.object({
  id: z.string(),
  genre: GenreDemande,
  de: z.string(), // nom du pair
  le: z.string(),
  detail: z.string(), // début du message, ou dossier demandé
  session: z.string().optional(), // session visée, pour une demande d'écriture : l'appli y affiche la carte
});
export type DemandeDuo = z.infer<typeof DemandeDuo>;

export const DossierOuvert = z.object({ machine: z.string().min(1).max(120), chemin: z.string().min(1).max(1000) });
export type DossierOuvert = z.infer<typeof DossierOuvert>;
export const DossierPair = DossierOuvert.extend({ nomMachine: z.string() });
export type DossierPair = z.infer<typeof DossierPair>;

// Droits accordés au pair, réglés par le propriétaire (voir relais/duo/droits.ts).
export const Droits = z.object({
  ecrireSansPermissions: z.enum(['demander', 'accepter']),
  ouvrirSession: z.enum(['jamais', 'demander', 'toujours']),
  dossiersOuverts: z.array(DossierOuvert).max(200),
  usagePartage: z.boolean(),
  modulesPartages: z.array(z.string().min(1).max(200)).max(200),
});
export type Droits = z.infer<typeof Droits>;
export const DROITS_PAR_DEFAUT: Droits = {
  ecrireSansPermissions: 'demander',
  ouvrirSession: 'demander',
  dossiersOuverts: [],
  usagePartage: false,
  modulesPartages: [],
};

export const LimiteUsage = z.object({ genre: z.enum(['session', 'semaine', 'autre']), fenetre: FenetreUsage });
export const UsagePartage = z.object({
  compte: z.string(),
  utilisateur: z.string(), // machine du propriétaire (le pair voit son compte, sous son nom)
  limites: z.array(LimiteUsage),
  releveLe: z.string(),
});
export type UsagePartage = z.infer<typeof UsagePartage>;

export const EntreeJournal = z.object({
  id: z.number(),
  le: z.string(),
  qui: z.string(),
  action: z.string(),
  cible: z.string(),
  detail: z.string(),
});
export type EntreeJournal = z.infer<typeof EntreeJournal>;

export const CorpsDroits = Droits;
export const CorpsDecision = z.object({
  accord: z.boolean(),
  machine: z.string().min(1).max(120).optional(), // passer la main : machine et dossier où s'ouvre la session neuve
  chemin: z.string().min(1).max(1000).optional(),
});
export type CorpsDecision = z.infer<typeof CorpsDecision>;
export interface ChoixDossier {
  readonly machine: string;
  readonly chemin: string;
}
export const CorpsMain = z.object({
  session: z.string().min(1).max(200),
  note: z.string().trim().max(2000).optional(),
});
export type CorpsMain = z.infer<typeof CorpsMain>;
export const CorpsAccordModule = z.object({ accepte: z.boolean() });
export type CorpsAccordModule = z.infer<typeof CorpsAccordModule>;
export const CorpsOuvertureDuo = z.object({
  machine: z.string().min(1).max(120),
  chemin: z.string().min(1).max(1000),
  message: z.string().min(1).max(TAILLE_MAX_TEXTE_SESSION),
  modele: z.string().min(1).max(120).optional(),
});
export type CorpsOuvertureDuo = z.infer<typeof CorpsOuvertureDuo>;

// Passer la main : ce que le donneur remet au receveur, construit sans appel à un modèle.
export const PaquetMain = z.object({
  titre: z.string().max(200),
  dossier: z.string().max(1000),
  messages: z.array(z.string().max(TAILLE_MAX_TEXTE_SESSION)).max(NOMBRE_MAX_MESSAGES_PAQUET),
  bilan: z.string().max(TAILLE_MAX_BILAN_PAQUET),
  fichiers: z.array(z.string().max(1000)).max(200),
  note: z.string().max(2000).optional(),
});
export type PaquetMain = z.infer<typeof PaquetMain>;

// Modules en commun : ce que le propriétaire propose (`modulesPartages`), et ce que le pair en fait.
export const OffreModule = z.object({
  id: IdModule,
  nom: z.string().max(80),
  version: z.string().max(40),
  description: z.string().max(400),
  empreinte: z.string().regex(/^[0-9a-f]{64}$/),
});
export type OffreModule = z.infer<typeof OffreModule>;
// Une proposition telle que le pair la voit : l'offre, son accord, et l'erreur (conflit avec un module local).
export interface ModuleDuo {
  readonly id: string;
  readonly nom: string;
  readonly version: string;
  readonly description: string;
  readonly accepte: boolean;
  readonly erreur: string | null;
}

// Fil d'activité : sessions partagées des deux côtés, avec qui elles tournent et à quel niveau.
export interface EntreeActivite {
  readonly id: string;
  readonly titre: string;
  readonly qui: string;
  readonly statut: string;
  readonly majLe: string;
  readonly partagee: NiveauPartage;
}
export interface ActiviteDuo {
  readonly sessions: EntreeActivite[];
  readonly demandes: DemandeDuo[];
  readonly journal: EntreeJournal[];
}
export interface ConflitDuo {
  readonly projet: string;
  readonly fichier: string;
  readonly qui: string;
  readonly session: string;
  readonly sessionPair: string;
  readonly le: string;
}

/** Machine d'un module reçu du pair : `duo:<utilisateur>`. */
export function machineDuo(utilisateur: string): string {
  return `${PREFIXE_MODULE_DUO}${utilisateur}`;
}

export function estModuleDuo(machine: string): boolean {
  return machine.startsWith(PREFIXE_MODULE_DUO);
}

/** Le texte remis à Claude pour un message du pair : son nom en tête. La bulle du fil garde le texte d'origine. */
export function texteRemisAClaude(auteur: string, texte: string): string {
  return `[Message de ${auteur}]\n${texte}`;
}

const FicheDuo = z.object({ fiche: ResumeSession, niveau: NiveauPartage });
const Horodate = z.object({ ts: z.string(), evt: Evenement });
const Ref = z.string().min(1).max(64);
const Session = z.string().min(1).max(200);

// Messages du lien entre relais. Un seul discriminant (`type`) ; le lien ne porte jamais la clé de la paire en clair
// hors de l'appairage (une fois, sous le code à usage unique).
export const MessageLien = z.discriminatedUnion('type', [
  z.object({ type: z.literal('appairage'), code: z.string(), utilisateur: z.string().min(1).max(64) }),
  z.object({ type: z.literal('appairage_ok'), paire: z.string(), cle: z.string(), utilisateur: z.string() }),
  z.object({ type: z.literal('lien'), paire: z.string(), nonce: z.string() }),
  z.object({ type: z.literal('defi'), nonce: z.string(), preuve: z.string() }),
  z.object({ type: z.literal('preuve'), preuve: z.string() }),
  z.object({ type: z.literal('lien_ok'), utilisateur: z.string() }),
  z.object({ type: z.literal('refus'), raison: z.string() }),
  z.object({ type: z.literal('partage'), sessions: z.array(FicheDuo) }),
  FicheDuo.extend({ type: z.literal('fiche') }),
  z.object({ type: z.literal('evenement'), sessionId: z.string(), ...Horodate.shape }),
  z.object({ type: z.literal('historique_demande'), sessionId: z.string() }),
  z.object({
    type: z.literal('historique'),
    sessionId: z.string(),
    evenements: z.array(Horodate).max(TAILLE_HISTORIQUE_DUO),
  }),
  z.object({ type: z.literal('duo_presence'), session: z.string(), present: z.boolean() }),
  z.object({ type: z.literal('revocation') }),
  z.object({ type: z.literal('identite'), utilisateur: z.string(), nom: z.string().max(40) }),
  // Échanges à deux (étape 2) : une requête porte `ref` ; son destinataire répond par `reponse` (ou la liste).
  z.object({
    type: z.literal('ecrire'),
    ref: Ref,
    session: Session,
    texte: z.string().min(1).max(TAILLE_MAX_TEXTE_SESSION),
    pieces: z.array(PieceJointe).max(NOMBRE_MAX_PIECES).optional(),
    // Message relayé depuis une session de l'expéditeur : la trace du receveur la nomme.
    relayeDe: z.object({ session: Session, titre: z.string().max(200) }).optional(),
  }),
  z.object({ type: z.literal('interrompre'), ref: Ref, session: Session }),
  z.object({
    type: z.literal('ouvrir_session'),
    ref: Ref,
    machine: z.string().min(1).max(120),
    chemin: z.string().min(1).max(1000),
    message: z.string().min(1).max(TAILLE_MAX_TEXTE_SESSION),
    modele: z.string().min(1).max(120).optional(),
  }),
  z.object({
    type: z.literal('reponse'),
    ref: Ref,
    ok: z.boolean(),
    raison: z.string().optional(),
    session: z.string().optional(),
  }),
  z.object({ type: z.literal('dossiers'), ref: Ref }),
  z.object({ type: z.literal('dossiers_reponse'), ref: Ref, dossiers: z.array(DossierPair).max(200) }),
  z.object({ type: z.literal('usage'), ref: Ref }),
  z.object({ type: z.literal('usage_reponse'), ref: Ref, usage: UsagePartage.nullable() }),
  // Passer la main : le donneur envoie le paquet ; le receveur répond `reponse` (session neuve ou refus).
  z.object({ type: z.literal('passer_main'), ref: Ref, paquet: PaquetMain }),
  // Modules en commun : offre du propriétaire, accord du pair, contenu, retrait, état du serveur.
  z.object({ type: z.literal('modules_offre'), modules: z.array(OffreModule).max(200) }),
  z.object({ type: z.literal('module_accord'), id: IdModule, accepte: z.boolean() }),
  z.object({
    type: z.literal('module_contenu'),
    manifeste: ManifesteModule,
    empreinte: z.string().regex(/^[0-9a-f]{64}$/),
    fichiers: z.array(FichierModule).max(FICHIERS_MAX_MODULE),
  }),
  z.object({ type: z.literal('module_retire'), id: IdModule }),
  z.object({
    type: z.literal('module_serveur'),
    id: IdModule,
    etat: EtatServeur,
    erreur: z.string().max(2000).nullable(),
  }),
  // Serveur d'un module reçu du pair : la requête part chez le propriétaire, la réponse revient par `ref`.
  z.object({ type: z.literal('serveur_requete'), ref: Ref, id: IdModule, requete: RequeteServeur }),
  z.object({
    type: z.literal('serveur_reponse'),
    ref: Ref,
    reponse: ReponseServeur.nullable(),
    raison: z.string().max(2000).optional(),
  }),
]);
export type MessageLien = z.infer<typeof MessageLien>;
