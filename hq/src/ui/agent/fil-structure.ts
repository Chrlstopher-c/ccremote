// Responsabilité : transformer le fil brut d'une session (événements datés) en blocs lisibles pour l'écran d'agent —
// messages de Chris, textes de Claude, réflexions, suites d'outils regroupées avec leurs résultats, sous-agents,
// questions, étapes — et le texte encore en cours d'écriture (flux). Pur, testable.
import type { Evenement, EvenementDate } from '../../donnees';

type Ev<T extends Evenement['type']> = Extract<Evenement, { type: T }>;

export interface OutilVu {
  appel: Ev<'outil'>;
  resultat: Ev<'resultat_outil'> | null;
  ts: string;
}

export type Bloc =
  | { genre: 'chris'; texte: string; ts: string; cle: string }
  | { genre: 'claude'; texte: string; ts: string; cle: string }
  | { genre: 'reflexion'; texte: string; cle: string }
  | { genre: 'outils'; outils: OutilVu[]; cle: string }
  | { genre: 'sous_agent'; info: Ev<'sous_agent'>; evenements: number; dernier: string; cle: string }
  | { genre: 'question'; texte: string; cle: string }
  | { genre: 'repere'; texte: string; niveau: 'info' | 'erreur'; cle: string };

export interface FilVu {
  blocs: Bloc[];
  enCours: string; // texte du flux pas encore remplacé par un événement `texte`
}

function ajouterOutil(blocs: Bloc[], e: EvenementDate, appel: Ev<'outil'>): void {
  const dernier = blocs[blocs.length - 1];
  const vu: OutilVu = { appel, resultat: null, ts: e.ts };
  if (dernier?.genre === 'outils') dernier.outils.push(vu);
  else blocs.push({ genre: 'outils', outils: [vu], cle: `o${e.seq}` });
}

function rattacherResultat(blocs: Bloc[], r: Ev<'resultat_outil'>): void {
  for (let i = blocs.length - 1; i >= 0; i--) {
    const b = blocs[i];
    if (b?.genre !== 'outils') continue;
    const vu = b.outils.find((o) => o.appel.id === r.outilId);
    if (vu) {
      vu.resultat = r;
      return;
    }
  }
}

function repere(e: Evenement): { texte: string; niveau: 'info' | 'erreur' } | null {
  switch (e.type) {
    case 'etape':
      return { texte: `Étape : ${e.resume}`, niveau: 'info' };
    case 'objectif_atteint':
      return { texte: `Objectif atteint — ${e.bilan}`, niveau: 'info' };
    case 'compaction':
      return { texte: `Contexte compacté (${Math.round(e.avant / 1000)} k → ${Math.round(e.apres / 1000)} k)`,
        niveau: 'info' };
    case 'relance':
      return { texte: `Relance : ${e.raison}`, niveau: 'info' };
    case 'erreur':
      return { texte: e.message, niveau: 'erreur' };
    case 'tour_fini':
      return { texte: `Tour fini en ${Math.max(1, Math.round(e.dureeMs / 1000))} s`, niveau: 'info' };
    default:
      return null;
  }
}

/** Les événements d'un sous-agent ne s'affichent pas dans le fil principal : ils nourrissent sa carte. */
function versSousAgent(blocs: Bloc[], agent: string, e: Evenement): boolean {
  const carte = blocs.find((b) => b.genre === 'sous_agent' && b.info.id === agent);
  if (carte?.genre !== 'sous_agent') return false;
  carte.evenements += 1;
  if (e.type === 'texte') carte.dernier = e.texte.slice(0, 160);
  if (e.type === 'outil') carte.dernier = `${e.nom} ${e.resume}`.slice(0, 160);
  return true;
}

export function structurerFil(fil: readonly EvenementDate[]): FilVu {
  const blocs: Bloc[] = [];
  let enCours = '';
  for (const e of fil) {
    const v = e.evt;
    const agent = 'agent' in v ? v.agent : undefined;
    if (agent && versSousAgent(blocs, agent, v)) continue;
    if (v.type === 'flux') {
      enCours += v.delta;
      continue;
    }
    if (v.type === 'texte') enCours = '';
    placer(blocs, e, v);
  }
  return { blocs, enCours };
}

function placer(blocs: Bloc[], e: EvenementDate, v: Evenement): void {
  const cle = `${v.type}${e.seq}`;
  if (v.type === 'message') blocs.push({ genre: 'chris', texte: v.texte, ts: e.ts, cle });
  else if (v.type === 'texte') blocs.push({ genre: 'claude', texte: v.texte, ts: e.ts, cle });
  else if (v.type === 'reflexion') blocs.push({ genre: 'reflexion', texte: v.texte, cle });
  else if (v.type === 'outil') ajouterOutil(blocs, e, v);
  else if (v.type === 'resultat_outil') rattacherResultat(blocs, v);
  else if (v.type === 'sous_agent') blocs.push({ genre: 'sous_agent', info: v, evenements: 0, dernier: '', cle });
  else if (v.type === 'question') blocs.push({ genre: 'question', texte: v.question, cle });
  else {
    const r = repere(v);
    if (r) blocs.push({ genre: 'repere', ...r, cle });
  }
}

/** Résumé d'une suite d'outils : « Lu 3 fichiers · Modifié 2 · 4 commandes ». */
export function resumeOutils(outils: readonly OutilVu[]): string {
  const compte = new Map<string, number>();
  for (const o of outils) {
    const n = o.appel.nom;
    const genre = /^(Read|Glob|Grep|LS)$/.test(n) ? 'Lu' : /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(n)
      ? 'Modifié' : n === 'Bash' ? 'Commandes' : /^Web/.test(n) ? 'Web' : /^(Task|Agent)$/.test(n) ? 'Agents'
      : 'Outils';
    compte.set(genre, (compte.get(genre) ?? 0) + 1);
  }
  return [...compte].map(([g, n]) => `${g} ${n}`).join(' · ');
}
