// Responsabilité : rendre l'état du parc et le fil d'une session en texte court, lisible par un agent (pur, testé).
import type { Projet, ResumeSession } from '../commun/session.ts';
import type { EtatParc, EvenementDate } from './client-relais.ts';

const VIVANTS = new Set(['demarrage', 'travail', 'compaction', 'attente', 'question']);
const EXTRAIT = 400;

export function couper(texte: string, max = EXTRAIT): string {
  const t = texte.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function ligneSession(s: ResumeSession): string {
  const ctx = s.contexte.max > 0 ? ` · contexte ${Math.round((s.contexte.tokens / s.contexte.max) * 100)} %` : '';
  const d = s.dialogue;
  const options = d ? d.options.map((o, i) => `[${i}] ${couper(o.libelle, 60)}`).join(' ') : '';
  const dialogue = d ? ` · DIALOGUE ${d.id} en attente : « ${couper(d.titre, 120)} » ${options}` : '';
  return `- ${s.id} · ${s.machine}:${s.projet.nom} · « ${s.titre} » · ${s.statut}${ctx}${dialogue}`;
}

export function texteParc(etat: EtatParc, toutes: boolean): string {
  const machines = etat.machines.map((m) => {
    const reveil = !m.enLigne && etat.reveilPossible.includes(m.id) ? ' (réveil possible : quart_reveiller)' : '';
    return `- ${m.id} : ${m.enLigne ? 'en ligne' : 'HORS LIGNE'}${reveil} — ${m.description}`;
  });
  const sessions = etat.sessions.filter((s) => toutes || VIVANTS.has(s.statut)).map(ligneSession);
  return [
    'Machines :',
    ...machines,
    '',
    toutes ? 'Sessions (toutes) :' : 'Sessions vivantes :',
    ...(sessions.length ? sessions : ['(aucune)']),
  ].join('\n');
}

// `projet` : nom de dossier (« ccremote-dev ») ou chemin absolu sur la machine cible.
export function trouverProjet(machine: string, projet: string, connus: readonly Projet[]): Projet | string {
  if (projet.startsWith('/')) {
    const connu = connus.find((p) => p.chemin === projet);
    return connu ?? { machine, chemin: projet, nom: projet.split('/').filter(Boolean).pop() ?? projet };
  }
  const exact = connus.filter((p) => p.nom === projet);
  if (exact.length === 1 && exact[0]) return exact[0];
  const proches = connus.filter((p) => p.nom.toLowerCase().includes(projet.toLowerCase()));
  if (exact.length === 0 && proches.length === 1 && proches[0]) return proches[0];
  const candidats = (exact.length ? exact : proches).map((p) => p.chemin);
  return candidats.length
    ? `projet ambigu sur ${machine} : ${candidats.join(', ')} — passe le chemin absolu`
    : `projet « ${projet} » introuvable sur ${machine} (projets connus : ${connus.map((p) => p.nom).join(', ')})`;
}

function ligneEvenement(e: EvenementDate): string | null {
  const v = e.evt;
  const heure = new Date(e.ts).toLocaleTimeString('fr-FR');
  switch (v.type) {
    case 'message':
      return `[${heure}] CHRIS/MCP > ${couper(v.texte)}`;
    case 'flux':
      return null;
    case 'texte':
      return v.agent ? null : `[${heure}] CLAUDE > ${couper(v.texte, 1200)}`;
    case 'outil':
      return v.agent ? null : `[${heure}] outil ${v.nom} : ${couper(v.resume, 160)}`;
    case 'resultat_outil':
      return v.erreur && !v.agent ? `[${heure}] ✗ erreur d'outil : ${couper(v.extrait, 200)}` : null;
    case 'sous_agent':
      return `[${heure}] sous-agent (${v.modele}) : ${couper(v.description, 120)}`;
    case 'etape':
      return `[${heure}] ÉTAPE : ${couper(v.resume)} → suite : ${couper(v.suite, 200)}`;
    case 'objectif_atteint':
      return `[${heure}] OBJECTIF ATTEINT : ${couper(v.bilan, 1200)}`;
    case 'question':
      return `[${heure}] QUESTION : ${couper(v.question, 1200)}`;
    case 'compaction':
      return `[${heure}] compaction ${v.avant} → ${v.apres} tokens`;
    case 'relance':
      return `[${heure}] relance : ${couper(v.raison, 160)}`;
    case 'tour_fini':
      return `[${heure}] — tour fini (${Math.round(v.dureeMs / 1000)} s)`;
    case 'erreur':
      return `[${heure}] ERREUR : ${couper(v.message)}`;
    case 'reflexion':
      return null;
    default:
      return null;
  }
}

export function texteFil(evts: readonly EvenementDate[], detail: boolean): { texte: string; dernier: number } {
  const lignes = evts
    .map((e) => (detail || e.evt.type !== 'outil' ? ligneEvenement(e) : null))
    .filter((l): l is string => l !== null);
  const dernier = evts.at(-1)?.seq ?? 0;
  return { texte: lignes.length ? lignes.join('\n') : '(rien de nouveau)', dernier };
}
