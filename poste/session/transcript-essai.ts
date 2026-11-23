// Responsabilité : écrire un petit transcript de Claude Code (deux échanges) dans une configuration Claude, pour les
// essais qui passent par les fonctions de session du vrai SDK. Réservé aux tests.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const UUID_ESSAI = '11111111-1111-4111-8111-111111111111';

export function ecrireTranscriptEssai(configDir: string, cwd: string, id = UUID_ESSAI): string {
  const dossier = join(configDir, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(dossier, { recursive: true });
  const ligne = (o: object): string =>
    JSON.stringify({ sessionId: id, cwd, timestamp: '2026-11-24T00:00:00.000Z', isSidechain: false, ...o });
  const texte = (t: string): object => ({ role: 'assistant', content: [{ type: 'text', text: t }] });
  const chemin = join(dossier, `${id}.jsonl`);
  const lignes = [
    ligne({ type: 'user', uuid: 'u1', parentUuid: null, message: { role: 'user', content: 'un' } }),
    ligne({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: texte('r1') }),
    ligne({ type: 'user', uuid: 'u2', parentUuid: 'a1', message: { role: 'user', content: 'deux' } }),
    ligne({ type: 'assistant', uuid: 'a2', parentUuid: 'u2', message: texte('r2') }),
  ];
  writeFileSync(chemin, `${lignes.join('\n')}\n`);
  return chemin;
}
