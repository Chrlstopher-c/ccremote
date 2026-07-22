/**
 * Responsabilité : composer la proposition de mandat d'équipe (A.3.1, H-52, H-66).
 * Pur — aucune I/O, aucun effet de bord. Utilisé exclusivement par `creer_equipe`
 * (H-61) : cette fonction ne crée rien, elle ne fait que rédiger ce que l'UI
 * présentera à l'approbation humaine.
 */

export interface PropositionMandat {
  readonly projet: string;
  readonly objectif: string;
  readonly critereArret: string | null;
  readonly perimetre: string;
  readonly texte: string;
}

const CLAUSES_FIXES = [
  // H-52 — rôle et obligation de validation réelle, pas seulement de lecture.
  'Tu es le team leader de cette équipe : responsable de A à Z (développement, tests, ' +
    'debug, tests end-to-end AVANT de déclarer terminé). Utilise les MCP à disposition ' +
    '(Playwright, Log Watcher, pty-mcp…) pour valider réellement — lire du code ne suffit pas.',
  // H-66 — attribution de l'émetteur : jamais laisser le lead déduire qui lui parle.
  "Tu es une équipe parmi d'autres, parfois en parallèle, toutes dirigées par le même " +
    "orchestrateur maître. Tes instructions viennent normalement de l'orchestrateur, pas de " +
    "l'humain. L'opérateur peut aussi te parler directement — ces messages-là sont identifiés " +
    'comme tels : ne jamais attribuer à l\'opérateur une instruction venue de l\'orchestrateur.',
] as const;

/**
 * Construit le texte du mandat à soumettre à l'approbation (H-61). N'écrit rien, ne
 * dispatche rien : le seul effet est de rendre une chaîne de caractères.
 */
export function construireMandatPropose(
  projet: string,
  objectif: string,
  critereArret: string | null,
  perimetre: string,
): PropositionMandat {
  const lignes = [
    `Objectif : ${objectif}`,
    `Périmètre autorisé : ${perimetre} (interdiction de sortir du worktree)`,
    `Critère d'arrêt : ${critereArret ?? '⚠ non fourni — à compléter avant approbation'}`,
    ...CLAUSES_FIXES,
  ];
  return { projet, objectif, critereArret, perimetre, texte: lignes.join('\n\n') };
}
