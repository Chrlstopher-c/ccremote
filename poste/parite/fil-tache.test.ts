// Responsabilité : tests du fil d'un sous-agent — consigne et relances, traduction sans marque `agent`, recherche par
// id de tool_use ou d'agent, refus d'identifiants douteux, fin de tour selon les méta-fichiers et la date du journal.
// Transcripts fabriqués dans un dossier temporaire, supprimé à la fin.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { filTache } from './fil-tache.ts';

const JOURNAL = { warn: () => undefined, debug: () => undefined, error: () => undefined } as unknown as Logger;
const AGENT = 'a0349d1bcf06cbff0';
const OUTIL = 'toolu_016ZXr5sErPjj1Eb6rW6SfdN';
const ANCIEN = new Date(Date.now() - 20 * 60_000);

let dossier = '';
let transcript = '';
let sousAgents = '';

beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'fil-tache-'));
  transcript = join(dossier, 'session.jsonl');
  sousAgents = join(dossier, 'session', 'subagents');
  mkdirSync(sousAgents, { recursive: true });
});
afterAll(() => {
  rmSync(dossier, { recursive: true, force: true });
});

function ecrire(nom: string, contenu: string | string[]): string {
  const chemin = join(sousAgents, nom);
  writeFileSync(chemin, typeof contenu === 'string' ? contenu : contenu.join('\n') + '\n');
  return chemin;
}

function ligne(objet: Record<string, unknown>): string {
  return JSON.stringify(objet);
}

function consigne(texte: string, horodatage: string): string {
  return ligne({
    type: 'user',
    isSidechain: true,
    timestamp: horodatage,
    message: { role: 'user', content: texte },
  });
}

function fil(horodatage: string, contenu: unknown[]): string {
  return ligne({
    type: 'assistant',
    isSidechain: true,
    timestamp: horodatage,
    message: { role: 'assistant', model: 'claude-haiku-5-5', content: contenu },
  });
}

function resultat(horodatage: string, outilId: string, extrait: string): string {
  return ligne({
    type: 'user',
    isSidechain: true,
    timestamp: horodatage,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: outilId, content: extrait }] },
  });
}

function lignesDeBase(): string[] {
  return [
    consigne('Vérifie le module.', '2026-11-20T10:00:00.000Z'),
    '{"type":"api-request","corps":"ignoré"}',
    fil('2026-11-20T10:00:05.000Z', [
      { type: 'thinking', thinking: 'Je lis le fichier.' },
      { type: 'text', text: 'Je regarde.' },
      { type: 'tool_use', id: OUTIL, name: 'Read', input: { file_path: '/x/module.ts' } },
    ]),
    resultat('2026-11-20T10:00:09.000Z', OUTIL, 'export const a = 1;'),
    '{"type":"assistant","timestamp":"2026-11-20T10:00:1',
  ];
}

function metaDe(objet: Record<string, unknown>): string {
  return ligne({ agentType: 'general-purpose', model: 'haiku', ...objet });
}

describe('fil complet d’un sous-agent', () => {
  test('consigne en message ; texte, réflexion, outil et résultat traduits sans marque agent', () => {
    ecrire(`agent-${AGENT}.jsonl`, lignesDeBase());
    ecrire(`agent-${AGENT}.meta.json`, metaDe({ description: 'Relecture', toolUseId: OUTIL, finished: false }));
    const r = filTache(transcript, AGENT, JOURNAL);
    expect(r).not.toBeNull();
    expect(r?.agent).toBe(AGENT);
    expect(r?.description).toBe('Relecture');
    expect(r?.modele).toBe('haiku');
    expect(r?.termine).toBe(false);
    expect(r?.evenements.map((e) => e.evt.type)).toEqual(['message', 'reflexion', 'texte', 'outil', 'resultat_outil']);
    expect(r?.evenements[0]).toEqual({
      ts: '2026-11-20T10:00:00.000Z',
      evt: { type: 'message', texte: 'Vérifie le module.' },
    });
    expect(r?.evenements.some((e) => 'agent' in e.evt)).toBe(false);
  });

  test('recherche par id de tool_use (méta-fichier) et par identifiant d’agent : même fil', () => {
    const parOutil = filTache(transcript, OUTIL, JOURNAL);
    const parAgent = filTache(transcript, AGENT, JOURNAL);
    expect(parOutil).not.toBeNull();
    expect(parOutil).toEqual(parAgent);
  });

  test('tâche inconnue : null ; identifiant avec séparateur ou ../ : null', () => {
    expect(filTache(transcript, 'toolu_inconnu', JOURNAL)).toBeNull();
    expect(filTache(transcript, '../session', JOURNAL)).toBeNull();
    expect(filTache(transcript, 'a/b', JOURNAL)).toBeNull();
    expect(filTache(transcript, 'a\\b', JOURNAL)).toBeNull();
    expect(filTache(transcript, '', JOURNAL)).toBeNull();
  });

  test('terminé (méta finished, journal calme depuis plus de 30 s) : tour_fini ajouté en dernier', () => {
    const autre = 'b111';
    const chemin = ecrire(`agent-${autre}.jsonl`, lignesDeBase());
    ecrire(`agent-${autre}.meta.json`, metaDe({ finished: true, toolUseId: 'toolu_b' }));
    utimesSync(chemin, ANCIEN, ANCIEN);
    const r = filTache(transcript, autre, JOURNAL);
    expect(r?.termine).toBe(true);
    const dernier = r?.evenements.at(-1);
    expect(dernier?.evt).toEqual({ type: 'tour_fini', dureeMs: 9000, contexte: 0 });
    expect(dernier?.ts).toBe('2026-11-20T10:00:09.000Z');
  });

  test('journal récent : pas de tour_fini, même si la méta dit finished', () => {
    const recent = 'c222';
    ecrire(`agent-${recent}.jsonl`, lignesDeBase());
    ecrire(`agent-${recent}.meta.json`, metaDe({ finished: true, toolUseId: 'toolu_c' }));
    const r = filTache(transcript, recent, JOURNAL);
    expect(r?.termine).toBe(false);
    expect(r?.evenements.some((e) => e.evt.type === 'tour_fini')).toBe(false);
  });

  test('journal figé depuis plus de 10 min : terminé même sans méta finished', () => {
    const fige = 'd333';
    const chemin = ecrire(`agent-${fige}.jsonl`, lignesDeBase());
    utimesSync(chemin, ANCIEN, ANCIEN);
    const r = filTache(transcript, fige, JOURNAL);
    expect(r?.termine).toBe(true);
    expect(r?.evenements.at(-1)?.evt.type).toBe('tour_fini');
  });

  test('plus de 2000 événements : les plus récents, la consigne toujours en tête', () => {
    const grand = 'e444';
    const lignes = [consigne('Consigne longue.', '2026-11-20T10:00:00.000Z')];
    for (let i = 0; i < 2100; i++)
      lignes.push(
        fil(`2026-11-20T10:01:${String(i % 60).padStart(2, '0')}.000Z`, [{ type: 'text', text: `pas ${i}` }]),
      );
    ecrire(`agent-${grand}.jsonl`, lignes);
    const r = filTache(transcript, grand, JOURNAL);
    expect(r?.evenements).toHaveLength(2000);
    expect(r?.evenements[0]?.evt).toEqual({ type: 'message', texte: 'Consigne longue.' });
    expect(r?.evenements.at(-1)?.evt).toEqual({ type: 'texte', texte: 'pas 2099' });
  });
});
