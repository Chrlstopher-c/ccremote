// Responsabilité : fabriquer des lignes de transcript Claude Code réalistes pour les tests de la parité (aucun fichier
// réel). Chaque fonction rend UNE ligne JSON, sans fin de ligne.
export function horodatage(n: number): string {
  return `2026-11-20T10:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`;
}

export interface UsageFactice {
  readonly input_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly output_tokens?: number;
}

export function assistant(
  le: string,
  contenu: unknown[],
  options: { usage?: UsageFactice; sidechain?: boolean; modele?: string } = {},
): string {
  const message: Record<string, unknown> = {
    model: options.modele ?? 'claude-opus-5-5',
    role: 'assistant',
    content: contenu,
  };
  if (options.usage) message['usage'] = options.usage;
  return JSON.stringify({ type: 'assistant', timestamp: le, isSidechain: options.sidechain ?? false, message });
}

export function outil(id: string, nom: string, entree: Record<string, unknown>): Record<string, unknown> {
  return { type: 'tool_use', id, name: nom, input: entree };
}

export function resultatOutil(id: string, contenu: unknown): Record<string, unknown> {
  return { type: 'tool_result', tool_use_id: id, content: contenu };
}

export function utilisateur(le: string, contenu: unknown, toolUseResult?: unknown): string {
  const ligne: Record<string, unknown> = { type: 'user', timestamp: le, message: { role: 'user', content: contenu } };
  if (toolUseResult !== undefined) ligne['toolUseResult'] = toolUseResult;
  return JSON.stringify(ligne);
}

export function notification(
  le: string,
  corps: { taskId: string; toolUseId: string; statut: string; sortie?: string },
): string {
  const sortie = corps.sortie ? `<output-file>${corps.sortie}</output-file>\n` : '';
  const texte = [
    '<task-notification>',
    `<task-id>${corps.taskId}</task-id>`,
    `<tool-use-id>${corps.toolUseId}</tool-use-id>`,
    sortie + `<status>${corps.statut}</status>`,
    '<summary>fin</summary>',
    '</task-notification>',
  ].join('\n');
  return utilisateur(le, texte);
}

export function prLink(le: string, numero: number, depot: string): string {
  return JSON.stringify({
    type: 'pr-link',
    sessionId: 'session-test',
    prNumber: numero,
    prUrl: `https://github.com/${depot}/pull/${numero}`,
    prRepository: depot,
    timestamp: le,
  });
}

export function ligneIgnoree(): string {
  return (
    '{"type":"api-request-shape","sessionId":"session-test","shapeHash":"abc","payload":"' + 'x'.repeat(2000) + '"}'
  );
}
