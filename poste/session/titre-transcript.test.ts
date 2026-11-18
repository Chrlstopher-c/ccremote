// Responsabilité : tests du titre d'une conversation lu dans son transcript (renommage, titre généré, premier message).
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { titreDuTranscript } from './titre-transcript.ts';

const journal = pino({ level: 'silent' });
const CWD = '/home/x/projet-alpha';

function transcript(lignes: object[]): string {
  const dossier = mkdtempSync(join(tmpdir(), 'titre-'));
  const chemin = join(dossier, 's.jsonl');
  writeFileSync(chemin, lignes.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return chemin;
}

const message = (texte: string, extra: object = {}): object => ({
  type: 'user',
  message: { role: 'user', content: texte },
  ...extra,
});

describe('titreDuTranscript', () => {
  test('un renommage gagne sur le titre généré et le premier message', () => {
    const chemin = transcript([
      message('Bonjour, on parle de la refonte'),
      { type: 'ai-title', aiTitle: 'Refonte' },
      { type: 'custom-title', customTitle: 'Ancien nom' },
      { type: 'custom-title', customTitle: 'Refonte du tableau' },
    ]);
    expect(titreDuTranscript(chemin, CWD, journal)).toBe('Refonte du tableau');
  });

  test('un nom par défaut (racine, nom du dossier) n’est pas un renommage : le titre généré prend la place', () => {
    const chemin = transcript([
      message('Salut'),
      { type: 'custom-title', customTitle: 'racine-2' },
      { type: 'custom-title', customTitle: 'projet-alpha' },
      { type: 'ai-title', aiTitle: 'Confirmation simple' },
    ]);
    expect(titreDuTranscript(chemin, CWD, journal)).toBe('Confirmation simple');
  });

  test('sans titre : premier message de Chris, sans méta ni balise, tronqué à 60 caractères', () => {
    const long = 'a'.repeat(70);
    const chemin = transcript([
      message('<command-name>/clear</command-name>'),
      message('Message méta', { isMeta: true }),
      message(`${long}\nsuite`),
    ]);
    expect(titreDuTranscript(chemin, CWD, journal)).toBe(`${'a'.repeat(60)}…`);
  });

  test('contenu en blocs : seul le texte compte', () => {
    const chemin = transcript([
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Regarde ce fichier' }] } },
    ]);
    expect(titreDuTranscript(chemin, CWD, journal)).toBe('Regarde ce fichier');
  });

  test('transcript absent : null, le repli revient à l’appelant', () => {
    expect(titreDuTranscript('/chemin/inexistant/s.jsonl', CWD, journal)).toBeNull();
  });

  test('ligne corrompue ignorée, le reste reste lisible', () => {
    const chemin = transcript([]);
    writeFileSync(chemin, `{pas du json\n${JSON.stringify({ type: 'ai-title', aiTitle: 'Utile' })}\n`);
    expect(titreDuTranscript(chemin, CWD, journal)).toBe('Utile');
  });
});
