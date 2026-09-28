// Responsabilité : les dialogues du TUI qui bloquent une session (AskUserQuestion, permission, validation de plan) —
// les reconnaître (transcript ou écran du pane) et traduire une réponse en touches. Pur, sans I/O.
import type { Dialogue, QuestionDialogue, ReponseDialogue } from '../../commun/session.ts';
import type { Ligne } from './traduction.ts';

type Objet = Record<string, unknown>;
export type Touche = { readonly touche: string } | { readonly texte: string };

const PIED = /Esc to (cancel|exit)|Enter to (confirm|select)/;
const SEPARATEUR = /^\s*[─━]{10,}\s*$/;
const NUMEROTEE = /^\s*(❯\s*)?(\d+)\.\s+(.*\S)\s*$/;
const CURSEUR = /^\s*❯\s*(.*\S)\s*$/;
const HAUTEUR_MAX = 40;

function blocs(contenu: unknown): Objet[] {
  return Array.isArray(contenu) ? contenu.filter((b): b is Objet => typeof b === 'object' && b !== null) : [];
}

const chaine = (v: unknown): string => (typeof v === 'string' ? v : '');

function question(brut: unknown): QuestionDialogue {
  const q = (typeof brut === 'object' && brut !== null ? brut : {}) as Objet;
  const options = Array.isArray(q['options']) ? (q['options'] as unknown[]) : [];
  return {
    question: chaine(q['question']),
    entete: chaine(q['header']),
    multiple: q['multiSelect'] === true,
    options: options.map((o) => {
      const opt = (typeof o === 'object' && o !== null ? o : {}) as Objet;
      return { libelle: chaine(opt['label']), description: chaine(opt['description']) };
    }),
  };
}

/** Les appels AskUserQuestion du fil principal portés par cette ligne. */
export function questionsDe(l: Ligne): Extract<Dialogue, { genre: 'questions' }>[] {
  if (l.type !== 'assistant' || l.isSidechain === true) return [];
  return blocs(l.message?.content)
    .filter((b) => b['type'] === 'tool_use' && b['name'] === 'AskUserQuestion')
    .map((b) => {
      const entree = (b['input'] ?? {}) as Objet;
      const qs = Array.isArray(entree['questions']) ? (entree['questions'] as unknown[]) : [];
      return { genre: 'questions' as const, id: chaine(b['id']), questions: qs.map(question) };
    })
    .filter((d) => d.id !== '' && d.questions.length > 0);
}

/** Les identifiants d'appels d'outil dont cette ligne porte le résultat. */
export function resultatsDe(l: Ligne): string[] {
  if (l.type !== 'user' || l.isSidechain === true) return [];
  return blocs(l.message?.content)
    .filter((b) => b['type'] === 'tool_result')
    .map((b) => chaine(b['tool_use_id']));
}

export interface MenuAffiche {
  readonly titre: string;
  readonly options: string[];
  readonly curseur: number;
}

// Remonte depuis le pied du dialogue ; un séparateur ne l'arrête qu'une fois la ligne du curseur trouvée (les
// dialogues d'AskUserQuestion rangent « Chat about this » sous un séparateur).
function corpsDuDialogue(lignes: readonly string[], pied: number): string[] {
  const corps: string[] = [];
  for (let i = pied - 1; i >= 0 && corps.length < HAUTEUR_MAX; i--) {
    const l = lignes[i] ?? '';
    if (SEPARATEUR.test(l)) {
      if (corps.some((c) => CURSEUR.test(c))) break;
      continue;
    }
    corps.unshift(l);
  }
  return corps;
}

function titreDe(lignes: readonly string[]): string {
  return lignes
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 400);
}

function menuNumerote(corps: readonly string[]): MenuAffiche | null {
  const lignes = corps.map((l, i) => ({ i, m: l.match(NUMEROTEE) })).filter((x) => x.m !== null);
  const options = lignes.filter((x, k) => Number(x.m?.[2]) === k + 1);
  if (options.length < 2) return null;
  const curseur = options.findIndex((x) => Boolean(x.m?.[1]));
  return {
    titre: titreDe(corps.slice(0, options[0]?.i ?? 0)),
    options: options.map((x) => (x.m?.[3] ?? '').replace(/^\[.\]\s*/, '')),
    curseur: Math.max(curseur, 0),
  };
}

function menuSimple(corps: readonly string[]): MenuAffiche | null {
  const ici = corps.findIndex((l) => CURSEUR.test(l));
  if (ici < 0) return null;
  let debut = ici;
  let fin = ici;
  while (debut > 0 && (corps[debut - 1] ?? '').trim()) debut--;
  while (fin < corps.length - 1 && (corps[fin + 1] ?? '').trim()) fin++;
  // Le bloc du curseur colle souvent au texte d'intro : on ne garde que les lignes indentées comme des options.
  while (debut < ici && !/^\s{2,}\S/.test(corps[debut] ?? '')) debut++;
  const options = corps.slice(debut, fin + 1).map((l) => l.replace(/^\s*❯?\s*/, '').trim());
  if (options.length < 2) return null;
  return { titre: titreDe(corps.slice(0, debut)), options, curseur: ici - debut };
}

/** Le menu que le TUI affiche en bas de l'écran, s'il y en a un. */
export function menuAffiche(ecran: string): MenuAffiche | null {
  const lignes = ecran.split('\n').map((l) => l.trimEnd());
  let pied = lignes.length - 1;
  while (pied >= 0 && !(lignes[pied] ?? '').trim()) pied--;
  let bas = pied;
  while (bas >= Math.max(0, pied - 3) && !PIED.test(lignes[bas] ?? '')) bas--;
  if (bas < Math.max(0, pied - 3)) return null;
  const corps = corpsDuDialogue(lignes, bas);
  return menuNumerote(corps) ?? menuSimple(corps);
}

export function dialogueChoix(menu: MenuAffiche): Extract<Dialogue, { genre: 'choix' }> {
  const empreinte = Bun.hash(`${menu.titre}\n${menu.options.join('\n')}`).toString(36);
  return { genre: 'choix', id: `menu-${empreinte}`, titre: menu.titre, options: menu.options };
}

const chiffre = (n: number): Touche => ({ touche: String(n) });

function touchesQuestion(q: QuestionDialogue, r: { choix: number[]; autre?: string } | undefined): Touche[] {
  const n = q.options.length;
  const autre = r?.autre?.trim();
  if (!q.multiple) {
    if (autre) return [chiffre(n + 1), { texte: autre }, { touche: 'Enter' }];
    return [chiffre((r?.choix[0] ?? 0) + 1)];
  }
  // Choix multiple : un chiffre coche sans déplacer le curseur (resté sur la 1re option) ; la saisie libre se tape
  // curseur posé sur sa ligne. Tab mène à l'onglet suivant, ou à la relecture.
  const t: Touche[] = (r?.choix ?? []).map((c) => chiffre(c + 1));
  if (autre) t.push(chiffre(n + 1), ...Array.from({ length: n }, () => ({ touche: 'Down' })), { texte: autre });
  t.push({ touche: 'Tab' });
  return t;
}

/** Les touches qui répondent à un AskUserQuestion affiché, puis valident l'écran de relecture s'il y en a un. */
export function touchesQuestions(questions: readonly QuestionDialogue[], r: ReponseDialogue): Touche[] | string {
  if (r.genre !== 'questions') return 'réponse d’un autre genre que le dialogue affiché';
  if (r.reponses.length !== questions.length) return `il faut ${questions.length} réponse(s)`;
  const touches: Touche[] = [];
  for (const [i, q] of questions.entries()) {
    const rep = r.reponses[i];
    const horsBornes = rep?.choix.some((c) => c >= q.options.length);
    if (horsBornes) return `choix hors des options de la question ${i + 1}`;
    if (!rep?.autre?.trim() && (rep?.choix.length ?? 0) === 0) return `question ${i + 1} sans réponse`;
    touches.push(...touchesQuestion(q, rep));
  }
  // Une seule question à choix unique part dès le choix ; sinon, l'écran de relecture attend « Submit answers ».
  if (questions.length > 1 || questions.some((q) => q.multiple)) touches.push(chiffre(1));
  return touches;
}

/** Les touches qui amènent le curseur d'un menu sur l'option voulue, puis la valident. */
export function touchesChoix(menu: MenuAffiche, index: number): Touche[] | string {
  if (index >= menu.options.length) return 'option hors du menu affiché';
  const ecart = index - menu.curseur;
  const fleche = { touche: ecart > 0 ? 'Down' : 'Up' };
  return [...Array.from({ length: Math.abs(ecart) }, () => fleche), { touche: 'Enter' }];
}
