// Responsabilité : la simulation de la démo — état des sessions à un instant, messages émis entre deux instants.
// Pur : l'horloge est passée en paramètre, rien n'est planifié ici.
import type { EtatRelais, EvenementDate, MessageClient, Projet, ResumeSession, VueMachine } from './contrat';
import { CYCLE_DEMO_MS, MACHINES_DEMO, type PasDemo, SCENARIO_SESSIONS, type SessionScenario } from './demo-scenario';

const FENETRE_HISTORIQUE_MS = 6 * CYCLE_DEMO_MS;
const CONTEXTE_MAX = 200_000;

interface Occurrence {
  readonly instant: number;
  readonly seq: number;
  readonly pas: PasDemo;
}

export function etatDemo(t0: number, maintenant: number): EtatRelais {
  return {
    version: 1,
    machines: machinesDemo(maintenant),
    sessions: SCENARIO_SESSIONS.map((def) => sessionALInstant(def, t0, maintenant)),
    notifications: [],
    reveilPossible: [],
  };
}

export function historiqueDemo(t0: number, maintenant: number, sessionId: string): EvenementDate[] {
  const fenetre = messagesEntre(t0, maintenant - FENETRE_HISTORIQUE_MS, maintenant);
  return fenetre.flatMap((m) => (m.type === 'evenement' && m.evenement.sessionId === sessionId ? [m.evenement] : []));
}

// Messages émis dans la fenêtre (avant, apres] : un événement, une éventuelle notification, et la session à jour.
export function messagesEntre(t0: number, avant: number, apres: number): MessageClient[] {
  return SCENARIO_SESSIONS.flatMap((def, indice) =>
    occurrencesEntre(def, t0, { avant, apres }, indice).flatMap((occ) => messagesDe(def, t0, occ)),
  );
}

export function sessionALInstant(def: SessionScenario, t0: number, t: number): ResumeSession {
  const debut = t0 + def.decalageMs;
  const origine = debut + Math.floor((t - debut) / CYCLE_DEMO_MS) * CYCLE_DEMO_MS;
  const courant = pasCourant(def, t - origine);
  return sessionAu(def, t0, origine + courant.a, courant);
}

export function machinesDemo(maintenant: number): VueMachine[] {
  return MACHINES_DEMO.map((m) => ({
    id: m.id,
    description: m.description,
    racines: ['/demo'],
    projets: projetsDeLaMachine(m.id),
    version: 'demo',
    etat: null,
    derniereVue: iso(maintenant),
    enLigne: true,
  }));
}

function projetsDeLaMachine(machine: string): Projet[] {
  const vus = new Map<string, Projet>();
  for (const s of SCENARIO_SESSIONS) if (s.machine === machine) vus.set(s.projet.chemin, s.projet);
  return [...vus.values()];
}

function pasCourant(def: SessionScenario, position: number): PasDemo {
  let courant = def.pas[0];
  for (const p of def.pas) if (p.a <= position) courant = p;
  return courant;
}

// `seq` unique et croissant par session, et unique entre sessions (l'indice de session tient sur le dernier chiffre).
function occurrencesEntre(
  def: SessionScenario,
  t0: number,
  fenetre: { readonly avant: number; readonly apres: number },
  indice: number,
): Occurrence[] {
  const { avant, apres } = fenetre;
  const debut = t0 + def.decalageMs;
  const premier = Math.floor((avant - debut) / CYCLE_DEMO_MS);
  const dernier = Math.floor((apres - debut) / CYCLE_DEMO_MS);
  const sortie: Occurrence[] = [];
  for (let k = premier; k <= dernier; k += 1) {
    def.pas.forEach((pas, i) => {
      const instant = debut + k * CYCLE_DEMO_MS + pas.a;
      if (instant > avant && instant <= apres) sortie.push({ instant, seq: (k * 100 + i) * 10 + indice, pas });
    });
  }
  return sortie;
}

function messagesDe(def: SessionScenario, t0: number, occ: Occurrence): MessageClient[] {
  const sortie: MessageClient[] = [];
  const ts = iso(occ.instant);
  if (occ.pas.evt) {
    sortie.push({ type: 'evenement', evenement: { seq: occ.seq, sessionId: def.id, ts, evt: occ.pas.evt } });
  }
  if (occ.pas.notif) {
    const notification = { seq: occ.seq, sessionId: def.id, ts, lue: false, ...occ.pas.notif };
    sortie.push({ type: 'notification', notification });
  }
  sortie.push({ type: 'session', session: sessionAu(def, t0, occ.instant, occ.pas) });
  return sortie;
}

function sessionAu(def: SessionScenario, t0: number, instant: number, p: PasDemo): ResumeSession {
  return {
    id: def.id,
    machine: def.machine,
    projet: def.projet,
    cwd: def.projet.chemin,
    titre: def.titre,
    objectif: null,
    modele: def.modele,
    compte: 'demo',
    autonomie: true,
    statut: p.statut,
    contexte: { tokens: 84_000, max: CONTEXTE_MAX },
    etapes: 3,
    compactions: 0,
    claudeSessionId: null,
    moteur: 'sdk',
    tmux: p.statut === 'fermee' ? null : `demo-${def.id}`,
    attachee: false,
    pilotee: true,
    dialogue: p.dialogue,
    creeLe: iso(t0),
    majLe: iso(instant),
    inactiveDepuis: p.inactive ? iso(instant) : null,
  };
}

function iso(t: number): string {
  return new Date(t).toISOString();
}
