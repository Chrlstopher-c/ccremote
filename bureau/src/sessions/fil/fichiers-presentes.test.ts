import { describe, expect, test } from 'bun:test';
import { cheminsPresentes } from './fichiers-presentes.ts';

const json = (o: unknown): string => JSON.stringify(o, null, 1);

describe('cheminsPresentes', () => {
  test('SendUserFile : images, PDF et Markdown envoyés ; chemins relatifs rattachés au dossier de la session', () => {
    const detail = json({ files: ['/tmp/a.png', 'rapport.pdf', '/tmp/notes.md', '/tmp/code.py'], status: 'normal' });
    expect(cheminsPresentes('SendUserFile', detail, '/home/x')).toEqual([
      '/tmp/a.png',
      '/home/x/rapport.pdf',
      '/tmp/notes.md',
    ]);
  });
  test('Read / Write : seulement les images et PDF (lire du code n’est pas présenter)', () => {
    expect(cheminsPresentes('Read', json({ file_path: '/tmp/capture.png' }), '')).toEqual(['/tmp/capture.png']);
    expect(cheminsPresentes('Read', json({ file_path: '/tmp/main.ts' }), '')).toEqual([]);
    expect(cheminsPresentes('Write', json({ file_path: '/tmp/notes.md', content: 'x' }), '')).toEqual([]);
  });
  test('un outil quelconque avec files (envoi Discord…) est montré ; entrée illisible ou tronquée : rien', () => {
    expect(cheminsPresentes('mcp__discord__send_message', json({ files: ['/tmp/p.jpg'] }), '')).toEqual(['/tmp/p.jpg']);
    expect(cheminsPresentes('Bash', '{"command": "ls"', '')).toEqual([]);
    expect(cheminsPresentes('Bash', json({ command: 'grim /tmp/x.png' }), '')).toEqual([]);
  });
  test('doublons retirés, six au plus', () => {
    const files = Array.from({ length: 9 }, (_, i) => `/tmp/${i % 8}.png`);
    expect(cheminsPresentes('SendUserFile', json({ files }), '').length).toBe(6);
  });
});
