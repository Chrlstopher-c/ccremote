import { describe, expect, test } from 'bun:test';
import type { QuestionDialogue } from '../../commun/session.ts';
import { menuAffiche, questionsDe, resultatsDe, touchesChoix, touchesQuestions } from './dialogue.ts';

const SEP = '─'.repeat(60);

const ECRAN_QUESTION = [
  '❯ Pose-moi deux questions',
  SEP,
  '←  ☐ Couleur  ☐ Fruits  ✔ Submit  →',
  'Quelle est votre couleur préférée ?',
  '❯ 1. Rouge',
  '     La couleur rouge',
  '  2. Vert',
  '     La couleur verte',
  '  3. Type something.',
  SEP,
  '  4. Chat about this',
  'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
  '',
].join('\n');

const ECRAN_CONFIANCE = [
  SEP,
  ' Accessing workspace:',
  ' /home/moi/projet',
  ' Quick safety check: Is this a project you created or one you trust?',
  ' Security guide',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  ' Enter to confirm · Esc to cancel',
].join('\n');

const ECRAN_PERMISSION = [
  SEP,
  ' Bash command',
  '   rm -rf build',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  "   2. Yes, and don't ask again for rm commands",
  '   3. No, and tell Claude what to do differently (esc)',
  ' Esc to cancel · Tab to amend',
].join('\n');

const ECRAN_REPOS = [SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on (shift+tab to cycle)'].join('\n');

const couleur: QuestionDialogue = {
  question: 'Couleur ?',
  entete: 'Couleur',
  multiple: false,
  options: [
    { libelle: 'Rouge', description: '' },
    { libelle: 'Vert', description: '' },
  ],
};
const fruits: QuestionDialogue = { ...couleur, question: 'Fruits ?', multiple: true };

describe('menus relevés à l’écran', () => {
  test('menu numéroté d’AskUserQuestion, « Chat about this » sous le séparateur compris', () => {
    const m = menuAffiche(ECRAN_QUESTION);
    expect(m?.options).toEqual(['Rouge', 'Vert', 'Type something.', 'Chat about this']);
    expect(m?.curseur).toBe(0);
  });

  test('menu non numéroté (confiance du dossier) : titre et curseur', () => {
    const m = menuAffiche(ECRAN_CONFIANCE);
    expect(m?.options).toEqual(['No, exit', 'Yes, I trust this folder']);
    expect(m?.titre).toContain('Quick safety check');
    expect(touchesChoix(m!, 1)).toEqual([{ touche: 'Down' }, { touche: 'Enter' }]);
  });

  test('permission : trois options, le titre porte la commande', () => {
    const m = menuAffiche(ECRAN_PERMISSION);
    expect(m?.options).toHaveLength(3);
    expect(m?.titre).toContain('rm -rf build');
    expect(touchesChoix(m!, 0)).toEqual([{ touche: 'Enter' }]);
  });

  test('invite au repos : aucun dialogue', () => {
    expect(menuAffiche(ECRAN_REPOS)).toBeNull();
  });
});

describe('touches d’AskUserQuestion (mesurées sur le TUI 2.1.280)', () => {
  test('une question simple : le chiffre suffit', () => {
    const r = { genre: 'questions' as const, id: 'x', reponses: [{ choix: [1] }] };
    expect(touchesQuestions([couleur], r)).toEqual([{ touche: '2' }]);
  });

  test('réponse libre : option « Type something », texte, Entrée', () => {
    const r = { genre: 'questions' as const, id: 'x', reponses: [{ choix: [], autre: 'Bordeaux' }] };
    expect(touchesQuestions([couleur], r)).toEqual([{ touche: '3' }, { texte: 'Bordeaux' }, { touche: 'Enter' }]);
  });

  test('question multiple seule avec réponse libre : curseur descendu sur la saisie, Tab, relecture', () => {
    const r = { genre: 'questions' as const, id: 'x', reponses: [{ choix: [0], autre: 'Kiwi' }] };
    expect(touchesQuestions([fruits], r)).toEqual([
      { touche: '1' },
      { touche: '3' },
      { touche: 'Down' },
      { touche: 'Down' },
      { texte: 'Kiwi' },
      { touche: 'Tab' },
      { touche: '1' },
    ]);
  });

  test('deux questions dont une multiple : cases, Tab, puis validation de la relecture', () => {
    const r = { genre: 'questions' as const, id: 'x', reponses: [{ choix: [0] }, { choix: [0, 1] }] };
    expect(touchesQuestions([couleur, fruits], r)).toEqual([
      { touche: '1' },
      { touche: '1' },
      { touche: '2' },
      { touche: 'Tab' },
      { touche: '1' },
    ]);
  });

  test('refuse une réponse vide ou hors bornes', () => {
    expect(touchesQuestions([couleur], { genre: 'questions', id: 'x', reponses: [{ choix: [] }] })).toBeTypeOf(
      'string',
    );
    expect(touchesQuestions([couleur], { genre: 'questions', id: 'x', reponses: [{ choix: [5] }] })).toBeTypeOf(
      'string',
    );
  });
});

describe('transcript', () => {
  test('AskUserQuestion posé puis répondu', () => {
    const posee = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'AskUserQuestion',
            input: { questions: [{ question: 'Q ?', header: 'H', multiSelect: false, options: [{ label: 'A' }] }] },
          },
        ],
      },
    };
    const d = questionsDe(posee);
    expect(d[0]?.id).toBe('toolu_1');
    expect(d[0]?.questions[0]?.options[0]?.libelle).toBe('A');
    const reponse = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] } };
    expect(resultatsDe(reponse)).toEqual(['toolu_1']);
  });
});
