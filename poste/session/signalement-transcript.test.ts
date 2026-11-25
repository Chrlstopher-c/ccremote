// Responsabilité : tests du signalement d'un transcript absent (un avertissement par transcript, puis debug).
import { describe, expect, test } from 'bun:test';
import { signalerTranscript } from './signalement-transcript.ts';

type Appel = unknown[];

function journalFactice(): {
  warns: Appel[];
  debugs: Appel[];
  warn: (...a: Appel) => void;
  debug: (...a: Appel) => void;
} {
  const warns: Appel[] = [];
  const debugs: Appel[] = [];
  return { warns, debugs, warn: (...a) => warns.push(a), debug: (...a) => debugs.push(a) };
}

const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });

describe('signalement d’un transcript absent', () => {
  test('un transcript absent n’est signalé en avertissement qu’une fois, puis en debug', () => {
    const j = journalFactice();
    const log = j as unknown as Parameters<typeof signalerTranscript>[0];
    for (let i = 0; i < 50; i++) signalerTranscript(log, '/tmp/absent-une-fois.jsonl', enoent, 'transcript illisible');
    expect(j.warns).toHaveLength(1);
    expect(j.debugs).toHaveLength(49);
  });

  test('deux transcripts absents donnent chacun leur avertissement', () => {
    const j = journalFactice();
    const log = j as unknown as Parameters<typeof signalerTranscript>[0];
    signalerTranscript(log, '/tmp/absent-a.jsonl', enoent, 'transcript illisible');
    signalerTranscript(log, '/tmp/absent-b.jsonl', enoent, 'transcript illisible');
    expect(j.warns).toHaveLength(2);
  });

  test('une erreur autre que ENOENT reste un avertissement à chaque fois', () => {
    const j = journalFactice();
    const log = j as unknown as Parameters<typeof signalerTranscript>[0];
    const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    signalerTranscript(log, '/tmp/acces.jsonl', eacces, 'transcript illisible');
    signalerTranscript(log, '/tmp/acces.jsonl', eacces, 'transcript illisible');
    expect(j.warns).toHaveLength(2);
    expect(j.debugs).toHaveLength(0);
  });
});
