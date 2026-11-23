// Responsabilité : test de la trace d'une réponse de Chris — la question ou la permission répondue entre dans le fil
// (événement `dialogue_resolu`), avec sa réponse, pour être rejouée après rechargement.
import { describe, expect, test } from 'bun:test';
import type { Evenement, Dialogue } from '../../commun/session.ts';
import { AvisSdk, TEXTE_QUESTION_PASSEE } from './avis-sdk.ts';

function banc() {
  const evenements: Evenement[] = [];
  let dialogue: Dialogue | null = null;
  const avis = new AvisSdk({
    emettre: (evt) => evenements.push(evt),
    maj: (champs) => {
      if (champs.dialogue !== undefined) dialogue = champs.dialogue;
    },
  });
  const affiche = (): Dialogue => {
    if (dialogue === null) throw new Error('aucun dialogue affiché');
    return dialogue;
  };
  return { avis, evenements, affiche };
}

describe('réponse de Chris dans le fil', () => {
  test('une question répondue rejoue la question et le libellé choisi', () => {
    const { avis, evenements, affiche } = banc();
    const entree = {
      questions: [
        { question: 'Couleur ?', options: [{ label: 'Rouge', description: '' }, { label: 'Bleu', description: '' }] },
      ],
    };
    void avis.autoriser('AskUserQuestion', entree, [], new AbortController().signal, false);
    expect(affiche().titre).toBe('Couleur ?');
    expect(avis.repondre({ id: affiche().id, index: 1 })).toBeNull();
    expect(evenements.at(-1)).toEqual({
      type: 'dialogue_resolu',
      dialogue: expect.objectContaining({ titre: 'Couleur ?' }),
      reponses: ['Bleu'],
    });
  });

  test('Passer : Claude apprend que la question est passée et le dialogue disparaît', async () => {
    const { avis, evenements, affiche } = banc();
    const entree = {
      questions: [
        { question: 'Couleur ?', options: [{ label: 'Rouge', description: '' }, { label: 'Bleu', description: '' }] },
        { question: 'Taille ?', options: [{ label: 'S', description: '' }, { label: 'M', description: '' }] },
      ],
    };
    const decision = avis.autoriser('AskUserQuestion', entree, [], new AbortController().signal, false);
    expect(avis.repondre({ id: affiche().id, passer: true })).toBeNull();
    expect(await decision).toEqual({ behavior: 'deny', message: TEXTE_QUESTION_PASSEE, interrupt: false });
    expect(evenements.at(-1)).toMatchObject({ type: 'dialogue_resolu', reponses: [] });
  });

  test('une permission refusée rejoue la demande et la décision', () => {
    const { avis, evenements, affiche } = banc();
    void avis.autoriser('Bash', { command: 'ls' }, [], new AbortController().signal, false);
    expect(avis.repondre({ id: affiche().id, index: 2 })).toBeNull();
    expect(evenements.at(-1)).toMatchObject({
      type: 'dialogue_resolu',
      dialogue: { permission: { outil: 'Bash' } },
      decision: 'refuser',
    });
  });
});
