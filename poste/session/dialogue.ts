// Responsabilité : les dialogues du TUI qui bloquent une session (AskUserQuestion, permission, validation de plan) —
// les reconnaître à l'écran du pane et traduire une réponse en touches. Pur, sans I/O.
// L'écran est la seule source fiable : le CLI n'écrit l'appel AskUserQuestion au transcript qu'une fois répondu.
import type { Dialogue, ReponseDialogue } from '../../commun/session.ts';

export type Touche = { readonly touche: string } | { readonly texte: string };

const PIED = /Esc to (cancel|exit)|Enter to (confirm|select)/;
const SEPARATEUR = /^\s*[─━]{10,}\s*$/;
const NUMEROTEE = /^\s*(❯\s*)?(\d+)\.\s+(.*\S)\s*$/;
const CURSEUR = /^\s*❯\s*(.*\S)\s*$/;
const HAUTEUR_MAX = 40;

export interface OptionAffichee {
  readonly libelle: string;
  readonly description: string;
  readonly case: 'cochee' | 'vide' | null; // null : option sans case (choix unique)
}

export interface MenuAffiche {
  readonly titre: string;
  readonly options: OptionAffichee[];
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

// La barre d'onglets d'AskUserQuestion (« ←  ☐ Couleur  ✔ Submit  → ») n'est pas du titre.
function titreDe(lignes: readonly string[]): string {
  return lignes
    .map((l) => l.trim())
    .filter((l) => l && !/^←.*→$/.test(l))
    .join(' ')
    .slice(0, 400);
}

const CASE = /^\[(.)\]\s*/;

function option(texte: string, description: string[]): OptionAffichee {
  const c = texte.match(CASE);
  return {
    libelle: texte.replace(CASE, ''),
    description: description.join(' '),
    case: c ? (c[1] === ' ' ? 'vide' : 'cochee') : null,
  };
}

// Options numérotées ; les lignes plus indentées qui suivent une option sont sa description (« Submit », la ligne de
// validation des cases, n'en est pas une).
function menuNumerote(corps: readonly string[]): MenuAffiche | null {
  const options: { texte: string; description: string[]; curseur: boolean; ligne: number }[] = [];
  let curseurSurValider = -1;
  for (const [i, l] of corps.entries()) {
    if (/^\s*❯\s*Submit\s*$/.test(l)) curseurSurValider = options.length; // ligne virtuelle après la saisie
    const m = l.match(NUMEROTEE);
    if (m && Number(m[2]) === options.length + 1) {
      options.push({ texte: m[3] ?? '', description: [], curseur: Boolean(m[1]), ligne: i });
      continue;
    }
    const derniere = options.at(-1);
    if (derniere && l.trim() && l.trim() !== 'Submit') derniere.description.push(l.trim());
  }
  if (options.length < 2) return null;
  return {
    titre: titreDe(corps.slice(0, options[0]?.ligne ?? 0)),
    options: options.map((o) => option(o.texte, o.description)),
    curseur: curseurSurValider >= 0 ? curseurSurValider : Math.max(options.findIndex((o) => o.curseur), 0),
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
  const options = corps.slice(debut, fin + 1).map((l) => option(l.replace(/^\s*❯?\s*/, '').trim(), []));
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

// La ligne de réponse libre d'AskUserQuestion : « Type something », ou le texte déjà tapé, juste avant « Chat about
// this ».
function indexSaisie(options: readonly OptionAffichee[]): number | null {
  const i = options.findIndex((o) => /^Type something\.?$/i.test(o.libelle));
  if (i >= 0) return i;
  return options.length >= 3 && /^Chat about this$/i.test(options.at(-1)?.libelle ?? '') ? options.length - 2 : null;
}

export function dialogueDe(menu: MenuAffiche): Dialogue {
  const empreinte = Bun.hash(`${menu.titre}\n${menu.options.map((o) => o.libelle).join('\n')}`).toString(36);
  return {
    id: `menu-${empreinte}`,
    titre: menu.titre,
    options: menu.options.map((o) => ({ libelle: o.libelle, description: o.description })),
    multiple: menu.options.some((o) => o.case !== null),
    saisie: indexSaisie(menu.options),
    coches: menu.options.flatMap((o, i) => (o.case === 'cochee' ? [i] : [])),
  };
}

const chiffre = (n: number): Touche => ({ touche: String(n) });

function deplacer(depuis: number, vers: number): Touche[] {
  const fleche = { touche: vers > depuis ? 'Down' : 'Up' };
  return Array.from({ length: Math.abs(vers - depuis) }, () => fleche);
}

// Cases : un chiffre coche ou décoche sans déplacer le curseur ; la réponse libre se tape curseur posé sur sa ligne ;
// la ligne « Submit », juste sous la saisie, mène à la question suivante ou à l'écran de relecture.
function touchesCases(menu: MenuAffiche, d: Dialogue, r: ReponseDialogue): Touche[] | string {
  const voulues = new Set(r.cases ?? d.coches);
  const texte = r.texte?.trim();
  if (texte && d.saisie !== null) voulues.add(d.saisie);
  if ([...voulues].some((c) => c >= d.options.length || c > 8)) return 'case hors du dialogue affiché';
  const touches: Touche[] = d.options.flatMap((_, i) =>
    voulues.has(i) !== d.coches.includes(i) ? [chiffre(i + 1)] : [],
  );
  if (d.saisie === null) return [...touches, { touche: 'Tab' }];
  if (texte) touches.push(...deplacer(menu.curseur, d.saisie), { texte });
  return [...touches, ...deplacer(texte ? d.saisie : menu.curseur, d.saisie + 1), { touche: 'Enter' }];
}

/** Les touches qui répondent au dialogue affiché, comme au clavier. */
export function touchesReponse(menu: MenuAffiche, r: ReponseDialogue): Touche[] | string {
  const d = dialogueDe(menu);
  if (d.multiple) return touchesCases(menu, d, r);
  const texte = r.texte?.trim();
  if (texte) {
    if (d.saisie === null) return 'ce dialogue n’accepte pas de réponse libre';
    return [...deplacer(menu.curseur, d.saisie), { texte }, { touche: 'Enter' }];
  }
  if (r.index === undefined || r.index >= d.options.length) return 'option hors du dialogue affiché';
  return [...deplacer(menu.curseur, r.index), { touche: 'Enter' }];
}
