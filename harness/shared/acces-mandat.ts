/**
 * Responsabilité : ce qu'un mandat autorise RÉELLEMENT à faire — source unique
 * de la notion d'accès et des outils qu'elle refuse au worker.
 *
 * `☠` Ce module existe parce que « lecture seule » n'était qu'une phrase. Le
 * champ `perimetre` d'un mandat est un texte libre rédigé par l'orchestrateur,
 * et il ne partait qu'à un seul endroit : le prompt initial du lead. Une équipe
 * annoncée « exploration, lecture seule » recevait donc exactement les mêmes
 * droits qu'une équipe de modification — `disallowedTools: []`, `permissionMode:
 * 'auto'`, donc pas même une invite. La consigne tenait à l'obéissance d'un
 * modèle, jamais à un verrou. Constaté le 2026-07-31, jamais déclenché en prod
 * seulement parce qu'aucun mandat de lecture n'avait encore mal tourné.
 *
 * La règle qui en découle : un droit s'énumère et se traduit en refus d'outils.
 * Il ne se rédige pas.
 */

export const ACCES_MANDAT = ['lecture', 'ecriture'] as const;
export type AccesMandat = (typeof ACCES_MANDAT)[number];

/**
 * `☠` Défaut SÛR, jamais permissif : un mandat dont l'accès est absent (ligne
 * antérieure à la migration 13, appel d'un chemin qui ne l'a pas encore câblé)
 * se voit refuser l'écriture. L'inverse ferait d'un oubli de câblage une
 * autorisation silencieuse — précisément le mode de panne que ce module ferme.
 */
export const ACCES_DEFAUT: AccesMandat = 'lecture';

/**
 * Outils refusés à une équipe en lecture seule.
 *
 * `☠` `Bash` EN FAIT PARTIE, et ce n'est pas négociable : un `Bash` ouvert rend
 * les trois autres décoratifs (`sed -i`, `tee`, `> fichier`, `git checkout`…).
 * Un « lecture seule » qui laisse passer un shell n'est pas un droit restreint,
 * c'est une convention avec une étape de plus. L'exploration reste entière par
 * `Read`, `Glob`, `Grep`, `WebSearch`/`WebFetch`, plus les outils MCP du harness
 * (`explorer_projets`, `lire_fichier`) qui sont en lecture par construction.
 *
 * `MultiEdit` est déprécié côté SDK : le citer ne coûte rien et couvre les CLI
 * plus anciens, où il existe encore. Un nom d'outil inconnu est inerte.
 */
export const OUTILS_ECRITURE: readonly string[] = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
];

/** Formes qu'un modèle écrit spontanément pour désigner un accès. */
const SYNONYMES: Readonly<Record<string, AccesMandat>> = {
  lecture: 'lecture',
  'lecture seule': 'lecture',
  'lecture-seule': 'lecture',
  'read only': 'lecture',
  'read-only': 'lecture',
  readonly: 'lecture',
  read: 'lecture',
  ro: 'lecture',
  ecriture: 'ecriture',
  écriture: 'ecriture',
  'lecture ecriture': 'ecriture',
  'lecture-écriture': 'ecriture',
  'read write': 'ecriture',
  'read-write': 'ecriture',
  readwrite: 'ecriture',
  write: 'ecriture',
  rw: 'ecriture',
};

export function estAccesMandat(valeur: unknown): valeur is AccesMandat {
  return typeof valeur === 'string' && (ACCES_MANDAT as readonly string[]).includes(valeur);
}

/**
 * Rend l'accès canonique, ou `null` si la valeur n'en désigne aucun.
 *
 * `☠` La sortie d'un modèle passée à un exécutable est une entrée utilisateur :
 * on normalise les formes attendues, on valide, et on refuse AVANT toute
 * écriture. Le schéma MCP énumère déjà les deux valeurs — cette fonction couvre
 * les chemins qui ne passent pas par lui (API web, relecture d'une ligne
 * ancienne, restauration).
 */
export function normaliserAcces(brut: string): AccesMandat | null {
  const nettoye = brut.trim().toLowerCase();
  if (nettoye.length === 0) return null;
  return SYNONYMES[nettoye] ?? null;
}

/** Motifs à passer à `WorkerSpec.deniedToolPatterns`, en plus du plancher (H-41). */
export function outilsRefusesPour(acces: AccesMandat): readonly string[] {
  return acces === 'lecture' ? OUTILS_ECRITURE : [];
}

/**
 * `☠` Message destiné à un MODÈLE : il énumère les valeurs acceptées, parce
 * qu'un LLM se corrige à partir d'une liste et jamais à partir d'un échec nu.
 */
export function messageAccesInconnu(demande: string): string {
  return (
    `accès « ${demande} » inconnu — valeurs acceptées : ${ACCES_MANDAT.join(', ')}. ` +
    '`lecture` refuse Write, Edit, NotebookEdit et Bash au worker ; ' +
    '`ecriture` ne laisse que le plancher de déni (H-41).'
  );
}
