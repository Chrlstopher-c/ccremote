// Responsabilité : ce que l'appli voit du parc quand ce nœud est fédéré — ses sessions et machines, plus celles des
// nœuds appariés, sans doublon. Règles : une machine tenue par un nœud en ligne passe par lui (ses copies vues par un
// tunnel SSH sont masquées, sauf les archivées) ; hors ligne, la copie locale reprend la main si elle existe ; jamais
// la machine de ce nœud reçue d'un autre. Fonction pure : aucune E/S, aucun état.
import type { VueMachine } from '../../commun/api-clients.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { NoeudDistant } from './distant.ts';

export interface EntreeVue {
  readonly locales: readonly ResumeSession[];
  readonly machinesLocales: readonly VueMachine[];
  readonly machineLocale: string;
  readonly noeuds: readonly NoeudDistant[];
  /** Instant du dernier changement de présence d'un nœud (ISO), pour `acces.depuis`. */
  readonly depuis: (membre: string) => string;
}

export interface VueFederee {
  readonly sessions: ResumeSession[];
  readonly machines: VueMachine[];
  /** Session d'un autre nœud → nœud qui la tient. */
  readonly routage: ReadonlyMap<string, string>;
  /** Machine joignable par un autre nœud → ce nœud (création de session). */
  readonly machinesRoutees: ReadonlyMap<string, string>;
  /** Machines du registre local dont les sessions sont masquées (le nœud qui les tient est en ligne). */
  readonly masquees: ReadonlySet<string>;
}

export function fusionnerVue(e: EntreeVue): VueFederee {
  const noeuds = [...e.noeuds].sort((a, b) => Number(b.enLigne) - Number(a.enLigne));
  const nativesEnLigne = new Set(
    noeuds.filter((n) => n.enLigne && n.machine !== e.machineLocale).map((n) => n.machine),
  );
  const connuesLocalement = new Set([...e.machinesLocales.map((m) => m.id), ...e.locales.map((s) => s.machine)]);
  const masquees = new Set([...nativesEnLigne].filter((m) => connuesLocalement.has(m)));
  // Une session archivée ici reste ici : le nœud n'annonce pas ses archivées, la masquer la ferait disparaître.
  const sessions = e.locales.filter((s) => !masquees.has(s.machine) || s.archivee === true);
  const routage = new Map<string, string>();
  const machinesRoutees = new Map<string, string>();
  const vues = new Set(sessions.map((s) => s.id));
  const regle = { machineLocale: e.machineLocale, nativesEnLigne, connuesLocalement };
  for (const n of noeuds) {
    if (accepteMachine(regle, n, n.machine) && !machinesRoutees.has(n.machine)) {
      machinesRoutees.set(n.machine, n.membre);
    }
    for (const s of n.sessions) {
      if (vues.has(s.id) || !accepteMachine(regle, n, s.machine)) continue;
      vues.add(s.id);
      sessions.push(s);
      routage.set(s.id, n.membre);
      if (!machinesRoutees.has(s.machine)) machinesRoutees.set(s.machine, n.membre);
    }
  }
  return { sessions, machines: machinesFusionnees(e, noeuds, machinesRoutees), routage, machinesRoutees, masquees };
}

interface Regle {
  readonly machineLocale: string;
  readonly nativesEnLigne: ReadonlySet<string>;
  readonly connuesLocalement: ReadonlySet<string>;
}

// Native (la machine du nœud) : en ligne, ou hors ligne sans copie locale. Relayée par lui (vue par ses tunnels) :
// seulement si personne d'autre ne la tient, ni en local ni nativement.
function accepteMachine(r: Regle, n: NoeudDistant, machine: string): boolean {
  if (machine === r.machineLocale) return false;
  if (machine === n.machine) return n.enLigne || !r.connuesLocalement.has(machine);
  return !r.nativesEnLigne.has(machine) && !r.connuesLocalement.has(machine);
}

function machinesFusionnees(
  e: EntreeVue,
  noeuds: readonly NoeudDistant[],
  routees: ReadonlyMap<string, string>,
): VueMachine[] {
  const parId = new Map(e.machinesLocales.map((m) => [m.id, m]));
  for (const [machine, membre] of routees) {
    const n = noeuds.find((x) => x.membre === membre);
    if (n) parId.set(machine, vueMachine(n, machine, e.depuis(membre)));
  }
  return [...parId.values()];
}

function vueMachine(n: NoeudDistant, machine: string, depuis: string): VueMachine {
  const native = machine === n.machine;
  const vue = native ? n.vue : null;
  return {
    id: machine,
    description: vue?.description || (native ? n.nom : machine),
    racines: vue?.racines ?? [],
    projets: vue?.projets ?? [],
    comptes: vue?.comptes ?? [],
    etatComptes: [],
    version: '',
    etat: null,
    derniereVue: depuis,
    enLigne: n.enLigne,
    acces: {
      etat: n.enLigne ? 'connecte' : 'injoignable',
      detail: native ? 'par le réseau Lanterne' : `par le réseau Lanterne, via ${n.nom}`,
      depuis,
    },
  };
}
