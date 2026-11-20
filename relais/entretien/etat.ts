// Responsabilité : assembler l'état d'entretien (versions, ressources, réveil, contrôles) depuis les vues des machines
// et de ce que chaque poste a annoncé. Pur. Les formes sont celles de app/ui/src/entretien/contrat.ts.
import type { VueMachine } from '../../commun/api-clients.ts';
import type { EtatMachine } from '../../commun/protocole-poste.ts';
import type { InfosPoste } from '../parc/postes.ts';
import { type Controle, controlesMachine } from './controles.ts';

export interface VersionPoste {
  readonly version: string;
  readonly commit: string | null;
  readonly empreinte: string | null;
  readonly empreinteAttendue: string | null;
  readonly aJour: boolean | null;
}

export interface Octets {
  readonly utilise: number;
  readonly total: number;
}

export interface Ressources {
  readonly cpu: number;
  readonly memoire: Octets;
  readonly echange: Octets | null;
  readonly disque: Octets;
  readonly charge: number;
  readonly demarreeDepuis: number;
  readonly releveLe: string;
}

export interface MachineEntretien {
  readonly id: string;
  readonly nom: string;
  readonly enLigne: boolean;
  readonly locale: boolean;
  readonly poste: VersionPoste | null;
  readonly claudeCode: { readonly cli: string | null; readonly sdk: string | null } | null;
  readonly ressources: Ressources | null;
  readonly reveil: { readonly possible: boolean; readonly relaisPar: string | null };
  readonly controles: readonly Controle[];
}

export interface EtatEntretien {
  readonly relais: { readonly version: string; readonly commit: string | null; readonly demarreLe: string };
  readonly machines: readonly MachineEntretien[];
}

export interface EntreeEtat {
  readonly relais: EtatEntretien['relais'];
  readonly vues: readonly VueMachine[];
  readonly locale: string | null;
  readonly infos: (id: string) => InfosPoste | null;
  readonly empreinteAttendue: string | null;
  readonly reveil: (id: string) => { readonly possible: boolean; readonly relaisPar: string | null };
}

function ressourcesDe(etat: EtatMachine | null, releveLe: string): Ressources | null {
  if (!etat) return null;
  return {
    cpu: etat.cpu,
    memoire: { utilise: etat.memoire.utilisee, total: etat.memoire.totale },
    echange: etat.echange ?? null,
    disque: { utilise: etat.disque.utilise, total: etat.disque.total },
    charge: etat.charge,
    demarreeDepuis: etat.demarreeDepuis,
    releveLe,
  };
}

// Une machine locale n'a rien à comparer : son code est celui de l'appli. Ailleurs, la comparaison exige les deux.
function versionDe(
  v: VueMachine,
  infos: InfosPoste | null,
  locale: boolean,
  attendue: string | null,
): VersionPoste | null {
  if (!v.version) return null;
  const empreinte = infos?.empreinte ?? null;
  const cible = locale ? null : attendue;
  const aJour = !locale && empreinte !== null && cible !== null ? empreinte === cible : null;
  return { version: v.version, commit: infos?.commit ?? null, empreinte, empreinteAttendue: cible, aJour };
}

function machineDe(v: VueMachine, e: EntreeEtat): MachineEntretien {
  const locale = v.id === e.locale;
  const infos = e.infos(v.id);
  const poste = versionDe(v, infos, locale, e.empreinteAttendue);
  const reveil = e.reveil(v.id);
  const installee = v.acces?.etat !== 'non_installe';
  const controles = controlesMachine({
    locale,
    enLigne: v.enLigne,
    installee,
    acces: v.acces ? { etat: v.acces.etat, detail: v.acces.detail } : null,
    reveilPossible: reveil.possible,
    aJour: poste?.aJour ?? null,
    comptesConnectes: v.etatComptes.filter((c) => c.connecte).length,
  });
  return {
    id: v.id,
    nom: v.description || v.id,
    enLigne: v.enLigne,
    locale,
    poste,
    claudeCode: infos?.claudeCode ?? null,
    ressources: ressourcesDe(v.etat, v.derniereVue),
    reveil,
    controles,
  };
}

export function assemblerEtat(e: EntreeEtat): EtatEntretien {
  return { relais: e.relais, machines: e.vues.map((v) => machineDe(v, e)) };
}
