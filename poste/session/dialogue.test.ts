import { describe, expect, test } from 'bun:test';
import { dialogueDe, menuAffiche, touchesReponse } from './dialogue.ts';

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

const ECRAN_CASES = [
  SEP,
  '←  ☒ Couleur  ☐ Fruits  ✔ Submit  →',
  'Quels fruits ?',
  '❯ 1. [✔] Pomme',
  '         Croquante',
  '  2. [ ] Poire',
  '         Juteuse',
  '  3. [ ] Type something',
  '     Submit',
  SEP,
  '  4. Chat about this',
  'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
].join('\n');

const menu = (ecran: string) => {
  const m = menuAffiche(ecran);
  if (!m) throw new Error('menu attendu');
  return m;
};

describe('dialogues relevés à l’écran', () => {
  test('AskUserQuestion : options, descriptions, « Chat about this » sous le séparateur, ligne de saisie', () => {
    const d = dialogueDe(menu(ECRAN_QUESTION));
    expect(d.options.map((o) => o.libelle)).toEqual(['Rouge', 'Vert', 'Type something.', 'Chat about this']);
    expect(d.options[0]?.description).toBe('La couleur rouge');
    expect(d.multiple).toBe(false);
    expect(d.saisie).toBe(2);
  });

  test('cases à cocher : état relevé, « Submit » n’est pas une description', () => {
    const d = dialogueDe(menu(ECRAN_CASES));
    expect(d.multiple).toBe(true);
    expect(d.coches).toEqual([0]);
    expect(d.options[2]?.description).toBe('');
  });

  test('menu non numéroté (confiance du dossier)', () => {
    const m = menu(ECRAN_CONFIANCE);
    expect(m.options.map((o) => o.libelle)).toEqual(['No, exit', 'Yes, I trust this folder']);
    expect(m.titre).toContain('Quick safety check');
    const id = dialogueDe(m).id;
    expect(touchesReponse(m, { id, index: 1 })).toEqual([{ touche: 'Down' }, { touche: 'Enter' }]);
  });

  test('permission : trois options, le titre porte la commande, pas de saisie libre', () => {
    const m = menu(ECRAN_PERMISSION);
    expect(m.options).toHaveLength(3);
    expect(m.titre).toContain('rm -rf build');
    expect(dialogueDe(m).saisie).toBeNull();
    expect(touchesReponse(m, { id: '', texte: 'non' })).toBeTypeOf('string');
  });

  test('invite au repos : aucun dialogue', () => {
    expect(menuAffiche(ECRAN_REPOS)).toBeNull();
  });
});

describe('touches (mesurées sur le TUI 2.1.280)', () => {
  test('choix unique : curseur amené sur l’option, Entrée', () => {
    expect(touchesReponse(menu(ECRAN_QUESTION), { id: '', index: 1 })).toEqual([
      { touche: 'Down' },
      { touche: 'Enter' },
    ]);
  });

  test('réponse libre en choix unique : ligne de saisie, texte, Entrée', () => {
    expect(touchesReponse(menu(ECRAN_QUESTION), { id: '', texte: 'Bordeaux' })).toEqual([
      { touche: 'Down' },
      { touche: 'Down' },
      { texte: 'Bordeaux' },
      { touche: 'Enter' },
    ]);
  });

  test('cases : seules les cases à changer, saisie curseur posé, puis Tab', () => {
    expect(touchesReponse(menu(ECRAN_CASES), { id: '', cases: [1], texte: 'Kiwi' })).toEqual([
      { touche: '1' },
      { touche: '2' },
      { touche: '3' },
      { touche: 'Down' },
      { touche: 'Down' },
      { texte: 'Kiwi' },
      { touche: 'Tab' },
    ]);
  });

  test('refuse une option hors du dialogue', () => {
    expect(touchesReponse(menu(ECRAN_QUESTION), { id: '', index: 9 })).toBeTypeOf('string');
  });
});
