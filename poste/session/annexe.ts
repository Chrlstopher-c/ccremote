// Responsabilité : les réglages d'une conversation annexe — copie complète de la session, en lecture seule, qui répond
// à une question sans modifier de fichier. Constantes seules : la copie et son enregistrement sont dans copie.ts.
export const TITRE_ANNEXE = 'Conversation annexe';

// Outils d'écriture retirés de l'annexe (le Bash aussi : il peut écrire).
export const OUTILS_INTERDITS_ANNEXE: readonly string[] = [
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'KillShell',
];

export const CONSIGNE_ANNEXE =
  'Conversation annexe : réponds brièvement à la question posée, sans modifier aucun fichier.';
