// Responsabilité : la liste fermée des routes qu'un nœud relaie à un pair (suffixe après `/api/sessions/:id/`,
// `/api/machines/:id/`, ou `/api/artefacts`). Pur, sans E/S : un geste hors liste n'est jamais exécuté chez le pair
// (ni accès, réglage global ou compte : ils restent locaux par nature).

/** `noeud` : une route du nœud entier (sans session ni machine), comme la liste des artefacts. */
export type PorteeGeste = 'session' | 'machine' | 'noeud';
export const METHODES_GESTE = ['GET', 'POST', 'PUT'] as const;
export type MethodeGeste = (typeof METHODES_GESTE)[number];
export const LONGUEUR_MAX_GESTE = 200;

const SEGMENT = '[A-Za-z0-9_.-]{1,160}';
// Nom de connecteur encodé dans l'adresse : « claude.ai Hugging Face » → `claude.ai%20Hugging%20Face` (24/11 : le « % »
// refusé rendait la bascule impossible depuis le portable sur une session de la tour).
const SEGMENT_NOM = '(?:[A-Za-z0-9_.~-]|%[0-9A-Fa-f]{2}){1,240}';

const MOTIFS_SESSION: readonly RegExp[] = [
  /^(evenements|contexte|connecteurs|taches|chapitres|messages|repondre|mode|modele|effort|rapide|autonomie)$/,
  /^(renommer|interrompre|compacter|fermer|reprendre|archiver|desarchiver|epingler|desepingler|marquer_lue)$/,
  /^(annexes|dupliquer|migrer|nuit|ultracode|rembobiner|remote-control)$/,
  /^(marquer_non_lue|parite|dossier|competences|fichiers|contenu|recherche|styles|style|prompt-systeme)$/,
  /^git\/(modifications|diff|annuler|commiter)$/,
  new RegExp(`^tours/${SEGMENT}/(modifications|diff|annuler)$`),
  new RegExp(`^artefacts/${SEGMENT}/(renommer|dupliquer|supprimer|epingler)$`),
  new RegExp(`^fichiers/${SEGMENT}$`),
  new RegExp(`^connecteurs/${SEGMENT_NOM}$`),
  new RegExp(`^taches/${SEGMENT}(/arreter)?$`),
  new RegExp(`^outils/${SEGMENT}/fond$`), // commande d'outil au premier plan passée en tâche de fond (Ctrl+B)
  new RegExp(`^parite/(taches/${SEGMENT}(/fil)?|resultat)$`), // fil d’un sous-agent (panneau)
];

/** Routes du nœud entier : artefacts, synthèse vocale et son service, dictée et son service, confirmation. */
const MOTIFS_NOEUD: readonly RegExp[] = [
  /^artefacts$/,
  /^voix$/,
  /^voix\/service$/,
  /^dictee$/,
  /^dictee\/service$/,
  /^confirmations\/[A-Za-z0-9-]{1,80}\/reponse$/,
  /^modules\/appel-pair$/, // appel de module relayé entre nœuds de même propriétaire (relais/federation/appels-pairs.ts)
];

const MOTIFS_MACHINE: readonly RegExp[] = [
  /^(dossiers|competences|competences\/contenu|instructions|styles|projets|importables|importer)$/,
  /^(memoire|taches-planifiees)$/,
  /^comptes\/relever$/, // relevé des comptes d'une machine (Paramètres › Comptes, bouton ↻)
  new RegExp(`^comptes/${SEGMENT}/detail$`), // détail d'un compte relevé ailleurs (Utilisation, limites)
  /^(voix|dictee)$/,
  new RegExp(`^(connecteurs|plugins)(/${SEGMENT_NOM})?$`),
];

/** Vrai si la route `suffixe` (après `/api/sessions/:id/` ou `/api/machines/:id/`) peut traverser le lien. */
export function estGesteRelayable(portee: PorteeGeste, suffixe: string): boolean {
  if (suffixe.length === 0 || suffixe.length > LONGUEUR_MAX_GESTE) return false;
  const motifs = { session: MOTIFS_SESSION, machine: MOTIFS_MACHINE, noeud: MOTIFS_NOEUD }[portee];
  return motifs.some((motif) => motif.test(suffixe));
}

/** Vrai pour une méthode HTTP que le lien sait transporter. */
export function estMethodeRelayable(methode: string): methode is MethodeGeste {
  return (METHODES_GESTE as readonly string[]).includes(methode);
}
