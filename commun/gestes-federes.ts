// Responsabilité : la liste fermée des routes qu'un nœud relaie à un pair (suffixe après `/api/sessions/:id/`,
// `/api/machines/:id/`, ou `/api/artefacts`). Pur, sans E/S : un geste hors liste n'est jamais exécuté chez le pair
// (ni accès, réglage global ou compte : ils restent locaux par nature).

/** `noeud` : une route du nœud entier (sans session ni machine), comme la liste des artefacts. */
export type PorteeGeste = 'session' | 'machine' | 'noeud';
export const METHODES_GESTE = ['GET', 'POST', 'PUT'] as const;
export type MethodeGeste = (typeof METHODES_GESTE)[number];
export const LONGUEUR_MAX_GESTE = 200;

const SEGMENT = '[A-Za-z0-9_.-]{1,160}';

const MOTIFS_SESSION: readonly RegExp[] = [
  /^(evenements|contexte|connecteurs|taches|chapitres|messages|repondre|mode|modele|effort|rapide|autonomie)$/,
  /^(renommer|interrompre|compacter|reprendre|archiver|desarchiver|epingler|desepingler|marquer_lue)$/,
  /^(annexes|dupliquer|nuit|ultracode)$/,
  /^(marquer_non_lue|parite|dossier|competences|fichiers|contenu|recherche|styles|style)$/,
  /^git\/(modifications|diff|annuler|commiter)$/,
  new RegExp(`^tours/${SEGMENT}/(modifications|diff|annuler)$`),
  new RegExp(`^artefacts/${SEGMENT}/(renommer|dupliquer|supprimer|epingler)$`),
  new RegExp(`^fichiers/${SEGMENT}$`),
  new RegExp(`^connecteurs/${SEGMENT}$`),
  new RegExp(`^taches/${SEGMENT}(/arreter)?$`),
  new RegExp(`^parite/(taches/${SEGMENT}|resultat)$`),
];

const MOTIFS_NOEUD: readonly RegExp[] = [/^artefacts$/];

const MOTIFS_MACHINE: readonly RegExp[] = [
  /^(dossiers|competences|competences\/contenu|instructions|styles|projets|importables|importer)$/,
  /^(memoire|taches-planifiees)$/,
  new RegExp(`^(connecteurs|plugins)(/${SEGMENT})?$`),
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
