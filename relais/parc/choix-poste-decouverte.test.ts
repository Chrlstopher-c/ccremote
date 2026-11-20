// Responsabilité : tests du choix de la machine d'une découverte présente sur plusieurs postes (écart #23).
import { describe, expect, test } from 'bun:test';
import type { Decouverte } from '../../commun/decouverte.ts';
import { decouverteParIdentifiant } from './decouvertes-postes.ts';

const base = (modifieLe: string, vivante?: boolean): Decouverte => ({
  id: 'abc-1',
  machine: 'x',
  cwd: '/home/trinity/projet',
  titre: 'Projet',
  modifieLe,
  branche: null,
  messages: 3,
  ...(vivante === undefined ? {} : { vivante }),
});

describe('decouverteParIdentifiant', () => {
  test('la machine où le processus tourne l emporte, même si l autre a écrit plus tard', () => {
    const r = decouverteParIdentifiant([
      { machine: 'portable', decouverte: base('2026-11-20T15:00:00.000Z') },
      { machine: 'tour', decouverte: base('2026-11-20T14:00:00.000Z', true) },
    ]);
    expect(r.map((d) => d.machine)).toEqual(['tour']);
  });

  test('sans processus : la copie écrite en dernier, quel que soit l ordre de connexion', () => {
    const r = decouverteParIdentifiant([
      { machine: 'tour', decouverte: base('2026-11-20T14:00:00.000Z') },
      { machine: 'portable', decouverte: base('2026-11-20T15:00:00.000Z') },
    ]);
    expect(r.map((d) => d.machine)).toEqual(['portable']);
  });

  test('deux identifiants différents restent deux découvertes', () => {
    const r = decouverteParIdentifiant([
      { machine: 'tour', decouverte: base('2026-11-20T14:00:00.000Z') },
      { machine: 'tour', decouverte: { ...base('2026-11-20T14:00:00.000Z'), id: 'autre-2' } },
    ]);
    expect(r).toHaveLength(2);
  });
});
