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

/**
 * `☠` `'rapport'` ajouté le 21/08 (mandat opérateur, garde 3) — le cas
 * majoritaire manquant : une équipe qui doit RENDRE UN RAPPORT mais a besoin
 * d'écrire ses scripts d'analyse jetables. `lecture` le lui interdisait
 * entièrement (Write/Edit/NotebookEdit refusés PARTOUT) ; `ecriture` ouvrait
 * tout le projet pour un besoin qui ne dépasse jamais son propre répertoire
 * de travail. `rapport` : lecture sur le projet entier, écriture confinée au
 * SEUL worktree de l'équipe — verrou posé par un hook `PreToolUse` actif
 * (`workers/confinement-ecriture.ts`), pas par `disallowedTools` (qui ne sait
 * pas exprimer « refuse hors de X »).
 */
export const ACCES_MANDAT = ['lecture', 'ecriture', 'rapport'] as const;
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
 * `☠` `Bash` N'EN FAIT PAS PARTIE, et c'est un choix explicite de Chris
 * (2026-07-31), pris en connaissance du trade-off — ne pas le « corriger ».
 *
 * L'argument, dans ses termes : « lecture seule » borne l'ÉCRITURE DE FICHIERS,
 * pas l'exécution de commandes. Un agent d'exploration travaille massivement au
 * shell (`rg`, `git log`, `find`, `ls`, `wc`) et c'est souvent le meilleur outil
 * pour ça ; le priver de `Bash` ne le rend pas plus sûr, il le rend infirme.
 *
 * Oui, un `Bash` ouvert permet techniquement d'écrire (`sed -i`, `tee`,
 * `> fichier`). La nuance qui rend le choix défendable : par ce chemin, une
 * écriture ne peut pas être ACCIDENTELLE — il faut l'avoir voulue, formulée et
 * exécutée. Ce que ce mode empêche, c'est le dérapage d'un agent qui « corrige
 * en passant » ce qu'il vient de lire, pas la malveillance d'un agent décidé.
 * Et les commandes réellement catastrophiques restent couvertes par le plancher
 * de déni (H-41), inconditionnel et posé sur tout dispatch, accès quel qu'il soit.
 *
 * `MultiEdit` est déprécié côté SDK : le citer ne coûte rien et couvre les CLI
 * plus anciens, où il existe encore. Un nom d'outil inconnu est inerte.
 */
export const OUTILS_ECRITURE: readonly string[] = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

/**
 * Outils par lesquels une équipe demanderait quelque chose à un humain. Refusés
 * à TOUTE équipe, quel que soit son accès.
 *
 * `☠` Le produit vise l'autonomie : Chris décide en amont, à l'approbation du
 * mandat (H-61), et plus jamais action par action. Personne ne regarde le flux
 * d'une équipe en train de travailler — une question posée là n'atteint aucun
 * humain.
 *
 * `☠` `AskUserQuestion` est une exception C.1.2 : elle atteint `canUseTool` même
 * sous une règle d'allow, y compris en `bypassPermissions`. Notre `canUseTool`
 * refuse (fail-closed), donc rien ne se bloquait — mais le lead y perdait un
 * tour et un aller-retour de budget. La retirer de sa liste d'outils lui évite
 * d'essayer : ce qu'il ne sait pas trancher, il l'écrit dans son rapport, et
 * c'est l'orchestrateur qui en fait un nouveau mandat.
 *
 * Mesuré le 2026-07-31 : l'outil figurait bien dans la liste annoncée à un
 * worker réel (`acceptation/bypass-denis-reel.ts`).
 */
export const OUTILS_INTERACTION_HUMAINE: readonly string[] = ['AskUserQuestion'];

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
  rapport: 'rapport',
  report: 'rapport',
  'lecture + rapport': 'rapport',
  'ecriture confinee': 'rapport',
  'écriture confinée': 'rapport',
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

/**
 * Motifs à passer à `WorkerSpec.deniedToolPatterns`, en plus du plancher (H-41).
 *
 * `☠` `'rapport'` ne figure PAS ici : ses outils d'écriture ne sont pas
 * refusés par nom, ils sont CONFINÉS par chemin (`WorkerSpec.confinerEcritureCwd`,
 * posé séparément par `dispatch-mandat.ts`) — cette grammaire-ci n'a pas de
 * négation pour exprimer « refuse hors de X ».
 */
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
    '`lecture` refuse Write, Edit et NotebookEdit au worker (Bash reste ouvert : ' +
    'explorer au shell est légitime) ; `rapport` autorise ces outils mais CONFINE ' +
    "leur écriture au worktree de l'équipe (verrou réel, pas une consigne) — pour une " +
    'équipe qui doit produire un rapport avec des scripts jetables ; `ecriture` ne ' +
    'laisse que le plancher de déni (H-41).'
  );
}
