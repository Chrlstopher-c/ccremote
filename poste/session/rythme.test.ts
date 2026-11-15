import { describe, expect, test } from 'bun:test';
import { type ContexteRythme, effetRythme } from './rythme.ts';

const legere: ContexteRythme = { tokens: 40_000, max: 1_000_000 };
const lourde: ContexteRythme = { tokens: 130_000, max: 1_000_000 };

describe('effetRythme', () => {
  test('une étape ajoute un événement d’étape et annonce la compaction seulement si le contexte est lourd', () => {
    expect(effetRythme('etape_terminee', { resume: 'r', suite: 's' }, legere)).toEqual({
      evenement: { type: 'etape', resume: 'r', suite: 's' },
      reponse: 'Étape enregistrée. Contexte léger (40k) : pas de compaction, enchaîne directement sur la suite.',
    });
    const lourdeRep = effetRythme('etape_terminee', { resume: 'r', suite: 's' }, lourde)?.reponse ?? '';
    expect(lourdeRep).toMatch(/Contexte lourd \(130k\)/);
  });

  test('objectif atteint et question donnent leur événement et leur réponse', () => {
    expect(effetRythme('objectif_atteint', { bilan: 'fini' }, legere)?.evenement).toEqual({
      type: 'objectif_atteint',
      bilan: 'fini',
    });
    expect(effetRythme('poser_question', { question: 'Q ?' }, legere)?.evenement).toEqual({
      type: 'question',
      question: 'Q ?',
    });
  });

  test('un champ absent devient une chaîne vide, un outil inconnu donne null', () => {
    expect(effetRythme('objectif_atteint', {}, legere)?.evenement).toEqual({ type: 'objectif_atteint', bilan: '' });
    expect(effetRythme('inconnu', {}, legere)).toBeNull();
  });
});
