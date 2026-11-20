// Responsabilité : tests des fiches fantômes (écart #9) : seules les fiches d'un poste en ligne, fermées, sans
// transcript sur aucun poste en ligne, sont retirées.
import { describe, expect, test } from 'bun:test';
import { type FicheFantome, fantomesARetirer } from './fantomes.ts';

const fiche = (over: Partial<FicheFantome>): FicheFantome => ({
  id: 'f1',
  machine: 'tour',
  conversation: 'c1',
  statut: 'fermee',
  archivee: false,
  ...over,
});

describe('fantomesARetirer', () => {
  test('une fiche fermée d un poste en ligne, sans transcript nulle part, est masquée', () => {
    const r = fantomesARetirer(
      [fiche({ id: 'fantome', conversation: 'disparue' }), fiche({ id: 'ok', conversation: 'c1' })],
      new Map([['tour', new Set(['c1'])]]),
      new Set(['tour']),
    );
    expect(r).toEqual(['fantome']);
  });

  test('un transcript présent sur un autre poste en ligne protège la fiche', () => {
    const r = fantomesARetirer(
      [fiche({ conversation: 'c2', machine: 'tour' })],
      new Map([
        ['tour', new Set<string>()],
        ['portable', new Set(['c2'])],
      ]),
      new Set(['tour', 'portable']),
    );
    expect(r).toEqual([]);
  });

  test('une fiche d un poste hors ligne n est jamais touchée', () => {
    const r = fantomesARetirer(
      [fiche({ machine: 'pi', conversation: 'x' })],
      new Map([['tour', new Set<string>()]]),
      new Set(['tour']),
    );
    expect(r).toEqual([]);
  });

  test('tant qu un poste en ligne n a pas annoncé ses transcripts, rien n est décidé', () => {
    const r = fantomesARetirer(
      [fiche({ conversation: 'x' })],
      new Map([['portable', new Set<string>()]]),
      new Set(['tour', 'portable']),
    );
    expect(r).toEqual([]);
  });

  test('une fiche encore en cours, sans conversation, ou déjà archivée n est pas un fantôme', () => {
    const r = fantomesARetirer(
      [
        fiche({ id: 'a', statut: 'attente' }),
        fiche({ id: 'b', conversation: null }),
        fiche({ id: 'c', archivee: true }),
      ],
      new Map([['tour', new Set<string>()]]),
      new Set(['tour']),
    );
    expect(r).toEqual([]);
  });
});
