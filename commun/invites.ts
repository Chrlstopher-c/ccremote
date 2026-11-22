// Responsabilité : les réglages d'un invité (modèles, efforts, parts de limite, machines, accès), leurs verdicts purs
// (ouverture d'une session, gestes permis) et la télémétrie agrégée. Aucune E/S : le nœud applique ces verdicts.
import { z } from 'zod';
import { EffortSession } from './session.ts';

export const FAMILLES = ['haiku', 'sonnet', 'opus', 'fable'] as const;
export type Famille = (typeof FAMILLES)[number];
export const ORDRE_EFFORTS: readonly EffortSession[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const ID_MEMBRE = z.string().regex(/^[a-f0-9]{12}$/);
const SEGMENT_GESTE = /^[A-Za-z0-9_.-]{1,160}$/;

export function familleDe(modele: string): Famille | null {
  const minuscule = modele.toLowerCase();
  return FAMILLES.find((famille) => minuscule.includes(famille)) ?? null;
}

export const AccesInvite = z.object({
  remoteControl: z.boolean(),
  terminaux: z.boolean(),
  sessionsAutres: z.boolean(),
  modules: z.boolean(),
  fichiersHors: z.boolean(),
});
export type AccesInvite = z.infer<typeof AccesInvite>;

const ListeEfforts = z
  .array(EffortSession)
  .max(5)
  .refine((efforts) => new Set(efforts).size === efforts.length, 'efforts en double');

export const ReglagesInvite = z.object({
  modeles: z.partialRecord(z.enum(FAMILLES), ListeEfforts), // famille absente = modèle interdit
  part5h: z.number().int().min(0).max(100),
  partSemaine: z.number().int().min(0).max(100).nullable(),
  simultanees: z.number().int().min(1).max(10),
  machines: z.array(ID_MEMBRE).max(20),
  surSaMachine: z.boolean(),
  prompt: z.string().max(8000),
  acces: AccesInvite,
  telemetrie: z.boolean(),
});
export type ReglagesInvite = z.infer<typeof ReglagesInvite>;

export function reglagesParDefaut(machine: string | null): ReglagesInvite {
  return {
    modeles: { haiku: ['low', 'medium', 'high'], sonnet: ['low', 'medium', 'high'] },
    part5h: 25,
    partSemaine: 25,
    simultanees: 2,
    machines: machine === null ? [] : [machine],
    surSaMachine: false,
    prompt: '',
    acces: { remoteControl: false, terminaux: false, sessionsAutres: false, modules: false, fichiersHors: false },
    telemetrie: true,
  };
}

export type EffortApplique = { ok: true; effort: EffortSession } | { ok: false; raison: string };

function effortsPermis(r: ReglagesInvite, famille: Famille | null): readonly EffortSession[] {
  return famille === null ? [] : (r.modeles[famille] ?? []);
}

function plusEleve(efforts: readonly EffortSession[]): EffortSession | null {
  const ordonnes = ORDRE_EFFORTS.filter((effort) => efforts.includes(effort));
  return ordonnes[ordonnes.length - 1] ?? null;
}

export function effortApplique(r: ReglagesInvite, modele: string, effort: EffortSession | null): EffortApplique {
  const famille = familleDe(modele);
  const permis = effortsPermis(r, famille);
  const haut = plusEleve(permis);
  if (haut === null) return { ok: false, raison: `modèle non permis : ${famille ?? modele}` };
  if (effort === null) return { ok: true, effort: haut };
  if (!permis.includes(effort)) return { ok: false, raison: `effort non permis : ${effort}` };
  return { ok: true, effort };
}

export function modeleParDefaut(r: ReglagesInvite): string | null {
  if (effortsPermis(r, 'sonnet').length > 0) return 'sonnet';
  return FAMILLES.find((famille) => effortsPermis(r, famille).length > 0) ?? null;
}

export interface EtatOuverture {
  readonly machine: string;
  readonly machineInvite: string;
  readonly modele: string | null;
  readonly effort: EffortSession | null;
  readonly sessionsEnCours: number;
  readonly consomme5h: number | null;
  readonly consommeSemaine: number | null;
  readonly compteSurSaMachine: boolean;
}

export type VerdictOuverture = { ok: true; modele: string; effort: EffortSession } | { ok: false; raison: string };
export type VerdictPart = { ok: true } | { ok: false; raison: string };

function raisonMachine(r: ReglagesInvite, e: EtatOuverture): string | null {
  if (e.machine === e.machineInvite) {
    if (!r.surSaMachine) return 'session sur sa machine non permise';
    return e.compteSurSaMachine ? null : 'sur sa machine : aucun compte Claude';
  }
  return r.machines.includes(e.machine) ? null : 'machine non permise';
}

/** Part atteinte si la part vaut 0 (tout refusé) ou si la consommation (inconnue = null) atteint la part. */
function partAtteinte(part: number, consomme: number | null): boolean {
  return part === 0 || (consomme !== null && consomme >= part);
}

export function verifierPart(
  r: ReglagesInvite,
  consomme5h: number | null,
  consommeSemaine: number | null,
): VerdictPart {
  if (partAtteinte(r.part5h, consomme5h)) return { ok: false, raison: 'part de la limite de 5 h atteinte' };
  if (r.partSemaine !== null && partAtteinte(r.partSemaine, consommeSemaine)) {
    return { ok: false, raison: 'part hebdomadaire atteinte' };
  }
  return { ok: true };
}

export function verifierOuverture(r: ReglagesInvite, e: EtatOuverture): VerdictOuverture {
  const machine = raisonMachine(r, e);
  if (machine !== null) return { ok: false, raison: machine };
  if (e.sessionsEnCours >= r.simultanees) {
    return { ok: false, raison: `trop de sessions simultanées (max ${r.simultanees})` };
  }
  const part = verifierPart(r, e.consomme5h, e.consommeSemaine);
  if (!part.ok) return part;
  const modele = e.modele ?? modeleParDefaut(r);
  if (modele === null) return { ok: false, raison: 'aucun modèle permis' };
  const effort = effortApplique(r, modele, e.effort);
  if (!effort.ok) return { ok: false, raison: effort.raison };
  return { ok: true, modele, effort: effort.effort };
}

export type PorteeGeste = 'session' | 'machine' | 'noeud';

const GESTES_SESSION: readonly string[] = [
  'evenements',
  'contexte',
  'chapitres',
  'messages',
  'repondre',
  'interrompre',
  'renommer',
  'archiver',
  'desarchiver',
  'epingler',
  'desepingler',
  'marquer_lue',
  'marquer_non_lue',
  'modele',
  'effort',
  'prompt-systeme',
  'taches',
  'fichiers',
  'contenu',
  'recherche',
];

function segmentValide(segment: string): boolean {
  return SEGMENT_GESTE.test(segment) && segment !== '.' && segment !== '..';
}

/** `taches/<seg>`, `taches/<seg>/arreter`, `fichiers/<seg>` : seules sous-ressources permises. */
function sousRessourcePermise(suffixe: string): boolean {
  const [racine, segment, action, reste] = suffixe.split('/');
  if (reste !== undefined || segment === undefined || !segmentValide(segment)) return false;
  if (racine === 'fichiers') return action === undefined;
  if (racine === 'taches') return action === undefined || action === 'arreter';
  return false;
}

export function gesteInvitePermis(portee: PorteeGeste, suffixe: string, acces: AccesInvite): boolean {
  if (portee !== 'session') return false;
  if (suffixe === 'remote-control') return acces.remoteControl;
  return GESTES_SESSION.includes(suffixe) || sousRessourcePermise(suffixe);
}

const BilanPartInvite = z.object({
  consomme: z.number().min(0),
  part: z.number().min(0).max(100),
  reprise: z.string().nullable(),
});
export type BilanPartInvite = z.infer<typeof BilanPartInvite>;

export const ActiviteInvite = z.object({
  actifAujourdhui: z.boolean(),
  derniere: z.string().nullable(),
  sessionsAujourdhui: z.number().int().min(0),
  sessionsEnCours: z.number().int().min(0),
  jetonsAujourdhui: z.number().int().min(0),
  part5h: BilanPartInvite.nullable(),
  semaine: BilanPartInvite.nullable(),
});
export type ActiviteInvite = z.infer<typeof ActiviteInvite>;

function somme(nombres: readonly number[]): number {
  return nombres.reduce((total, n) => total + n, 0);
}

function plusRecente(isos: readonly (string | null)[]): string | null {
  const presentes = isos.filter((iso): iso is string => iso !== null);
  return presentes.reduce<string | null>(
    (meilleure, iso) => (meilleure === null || Date.parse(iso) > Date.parse(meilleure) ? iso : meilleure),
    null,
  );
}

function fusionnerPart(bilans: readonly (BilanPartInvite | null)[]): BilanPartInvite | null {
  const presents = bilans.filter((b): b is BilanPartInvite => b !== null);
  const premier = presents[0];
  if (premier === undefined) return null;
  return {
    consomme: somme(presents.map((b) => b.consomme)),
    part: premier.part,
    reprise: premier.reprise,
  };
}

/** Somme des compteurs ; derniere la plus récente ; part et reprise du premier bilan présent. */
export function fusionnerActivites(liste: readonly ActiviteInvite[]): ActiviteInvite | null {
  if (liste.length === 0) return null;
  return {
    actifAujourdhui: liste.some((a) => a.actifAujourdhui),
    derniere: plusRecente(liste.map((a) => a.derniere)),
    sessionsAujourdhui: somme(liste.map((a) => a.sessionsAujourdhui)),
    sessionsEnCours: somme(liste.map((a) => a.sessionsEnCours)),
    jetonsAujourdhui: somme(liste.map((a) => a.jetonsAujourdhui)),
    part5h: fusionnerPart(liste.map((a) => a.part5h)),
    semaine: fusionnerPart(liste.map((a) => a.semaine)),
  };
}
