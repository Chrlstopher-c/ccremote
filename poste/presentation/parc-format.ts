// Responsabilité : le rendu en texte, pour un agent, des sorties du parc (machines, sessions, fil, ouverture) — pur,
// testé. Le fil ne garde que ce qui se lit (messages, réponses, questions, erreurs), borné en lignes et en longueur.
import type { MachineParc, SessionParc } from '../../commun/parc.ts';
import type { Evenement } from '../../commun/session.ts';

const LIGNES_FIL_MAX = 40;
const EXTRAIT_MAX = 400;
const REPONSE_MAX = 1200;
const TITRE_MAX = 120;

export function couper(texte: string, max = EXTRAIT_MAX): string {
  const t = texte.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function heure(ts: string): string {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function ligneMachine(m: MachineParc): string {
  const etat = m.enLigne ? 'en ligne' : `hors ligne${m.reveilPossible ? ' (réveil possible : parc_reveiller)' : ''}`;
  return `- ${m.id} : ${etat} — ${m.description}`;
}

export function texteMachines(s: { readonly machines: readonly MachineParc[] }): string {
  return s.machines.length === 0 ? 'Aucune machine.' : s.machines.map(ligneMachine).join('\n');
}

function ligneSession(s: SessionParc): string {
  const terminal = s.terminal ? ' · terminal' : '';
  const dialogue = s.dialogue
    ? ` · DIALOGUE ${s.dialogue.id} en attente : « ${couper(s.dialogue.titre, TITRE_MAX)} »`
    : '';
  const titre = couper(s.titre, TITRE_MAX);
  const activite = `activité ${heure(s.majLe)}`;
  return `- ${s.id} · ${s.machine}:${s.projet} · « ${titre} » · ${s.statut} · ${activite}${terminal}${dialogue}`;
}

export function texteSessions(s: { readonly sessions: readonly SessionParc[] }): string {
  return s.sessions.length === 0 ? 'Aucune session.' : s.sessions.map(ligneSession).join('\n');
}

interface EvenementHorodate {
  readonly ts: string;
  readonly evt: Evenement;
}

function ligneEvenement(e: EvenementHorodate): string | null {
  const v = e.evt;
  const h = heure(e.ts);
  switch (v.type) {
    case 'message':
      return `[${h}] CHRIS > ${couper(v.texte)}`;
    case 'texte':
      return v.agent ? null : `[${h}] CLAUDE > ${couper(v.texte, REPONSE_MAX)}`;
    case 'question':
      return `[${h}] QUESTION : ${couper(v.question, REPONSE_MAX)}`;
    case 'erreur':
      return `[${h}] ERREUR : ${couper(v.message)}`;
    case 'objectif_atteint':
      return `[${h}] OBJECTIF ATTEINT : ${couper(v.bilan, REPONSE_MAX)}`;
    case 'etape':
      return `[${h}] ÉTAPE : ${couper(v.resume)} → suite : ${couper(v.suite)}`;
    case 'relance':
      return `[${h}] relance : ${couper(v.raison)}`;
    case 'dialogue_resolu':
      return `[${h}] dialogue résolu : ${couper(v.dialogue.titre, TITRE_MAX)}`;
    default:
      return null;
  }
}

/** Les événements lisibles, dans l'ordre, les plus récents en fin de texte ; rien de lisible : une phrase. */
export function texteFil(evenements: readonly EvenementHorodate[]): string {
  const lignes = evenements
    .map(ligneEvenement)
    .filter((l): l is string => l !== null)
    .slice(-LIGNES_FIL_MAX);
  return lignes.length > 0 ? lignes.join('\n') : '(rien de lisible dans le fil)';
}

export function texteOuverture(s: { readonly id: string; readonly machine: string }): string {
  return `Session ouverte : ${s.id} sur ${s.machine}. Elle tourne sur cette machine et reste visible dans Lanterne.`;
}

export function texteReveil(machine: string, par: string | undefined): string {
  const origine = par ? ` (envoyé par ${par})` : '';
  return `Réveil envoyé à ${machine}${origine}. Vérifier avec parc_machines dans quelques dizaines de secondes.`;
}
