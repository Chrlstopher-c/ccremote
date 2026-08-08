/**
 * Responsabilité : TOUTES les mesures du protocole sortent d'ici — aucune n'est
 * estimée. Lit le transcript JSONL écrit par le CLI, ligne par ligne, et en tire
 * ce que `contrat.ts` définit comme `Execution`.
 *
 * `☠` Le JSONL n'est pas un type publié par le SDK (c'est un format de stockage
 * interne au CLI) : chaque champ lu est revérifié par `typeof`/`Array.isArray`
 * avant usage, jamais fait confiance à un cast seul. Une ligne illisible ou un
 * `type` inconnu sont ignorés — jamais une exception qui remonte et prive le
 * protocole d'une mesure entière.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LigneTrace, TentativeTest, UsageOutil } from './contrat.ts';

export function cheminTranscript(configDir: string, cwd: string, sessionId: string): string {
  const cleProjet = cwd.replace(/[/\\]/g, '-');
  return join(configDir, 'projects', cleProjet, `${sessionId}.jsonl`);
}

export interface MesuresTranscript {
  readonly sessionId: string;
  readonly dureeMs: number;
  readonly nbTours: number;
  readonly usageOutils: readonly UsageOutil[];
  readonly appelsOutilsTotal: number;
  readonly tentatives: readonly TentativeTest[];
  readonly tentativesAvantSucces: number | null;
  readonly reussiDuPremierCoup: boolean;
  readonly modele: string;
}

/** Marqueurs de commande de test — voir la spec du protocole (`Bash` + l'un des trois). */
const MARQUEURS_COMMANDE_TEST: readonly string[] = ['bun test', 'bun run test', 'bunx --bun test'];
const TRONCATURE_TRACE = 200;
const LARGEUR_EXTRAIT_INJECTION = 400;

/** Un bloc de `message.content`, forme non publiée par le SDK — chaque champ est revérifié à l'usage. */
interface BlocContenu {
  readonly type?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: {
    readonly command?: unknown;
    readonly file_path?: unknown;
    readonly path?: unknown;
  };
  readonly text?: string;
  readonly tool_use_id?: string;
  readonly is_error?: boolean;
  readonly content?: unknown;
}

interface LigneJsonl {
  readonly type?: string;
  readonly timestamp?: string;
  readonly message?: { readonly content?: unknown; readonly model?: string };
}

interface CompteurOutil {
  appels: number;
  echecs: number;
}

interface CandidatTentative {
  readonly rang: number;
  readonly commande: string;
  readonly survenueA: number;
}

interface EtatExtraction {
  premierTimestamp: number | null;
  dernierTimestamp: number | null;
  nbTours: number;
  modele: string;
  readonly usage: Map<string, CompteurOutil>;
  readonly idVersNom: Map<string, string>;
  readonly candidatsTentative: Map<string, CandidatTentative>;
  readonly reussiteTentative: Map<string, boolean>;
  rangSuivant: number;
}

function etatInitial(): EtatExtraction {
  return {
    premierTimestamp: null,
    dernierTimestamp: null,
    nbTours: 0,
    modele: '',
    usage: new Map(),
    idVersNom: new Map(),
    candidatsTentative: new Map(),
    reussiteTentative: new Map(),
    rangSuivant: 1,
  };
}

function texteDeContenu(contenu: unknown): string {
  if (typeof contenu === 'string') return contenu;
  if (!Array.isArray(contenu)) return '';
  // `Array.isArray` ne typent que `any[]` — cast vers `unknown[]` pour forcer une
  // re-vérification explicite (`typeof`) de chaque élément avant tout usage.
  return (contenu as unknown[])
    .map((bloc) => {
      if (bloc === null || typeof bloc !== 'object') return '';
      // Champ non garanti par le format JSONL : revérifié par `typeof` juste après.
      const texte = (bloc as { text?: unknown }).text;
      return typeof texte === 'string' ? texte : '';
    })
    .join('\n');
}

function estCommandeDeTest(commande: string): boolean {
  return MARQUEURS_COMMANDE_TEST.some((marqueur) => commande.includes(marqueur));
}

function enregistrerTimestamp(etat: EtatExtraction, ligne: LigneJsonl): void {
  if (typeof ligne.timestamp !== 'string') return;
  const t = Date.parse(ligne.timestamp);
  if (Number.isNaN(t)) return;
  if (etat.premierTimestamp === null) etat.premierTimestamp = t;
  etat.dernierTimestamp = t;
}

function enregistrerEnTete(etat: EtatExtraction, ligne: LigneJsonl): void {
  if (ligne.type !== 'assistant') return;
  etat.nbTours += 1;
  if (etat.modele === '' && typeof ligne.message?.model === 'string') etat.modele = ligne.message.model;
}

function traiterToolUse(etat: EtatExtraction, bloc: BlocContenu, timestampLigne: number | null): void {
  if (bloc.type !== 'tool_use' || typeof bloc.name !== 'string') return;
  const compteur = etat.usage.get(bloc.name) ?? { appels: 0, echecs: 0 };
  compteur.appels += 1;
  etat.usage.set(bloc.name, compteur);
  if (typeof bloc.id === 'string') etat.idVersNom.set(bloc.id, bloc.name);
  if (bloc.name !== 'Bash' || typeof bloc.id !== 'string') return;
  const commande = typeof bloc.input?.command === 'string' ? bloc.input.command : '';
  if (!estCommandeDeTest(commande)) return;
  const base = etat.premierTimestamp ?? 0;
  const survenueA = timestampLigne === null ? 0 : timestampLigne - base;
  etat.candidatsTentative.set(bloc.id, { rang: etat.rangSuivant, commande, survenueA });
  etat.rangSuivant += 1;
}

function traiterToolResult(etat: EtatExtraction, bloc: BlocContenu): void {
  if (bloc.type !== 'tool_result' || typeof bloc.tool_use_id !== 'string') return;
  const estErreur = bloc.is_error === true;
  const nom = etat.idVersNom.get(bloc.tool_use_id);
  if (estErreur && nom !== undefined) {
    const compteur = etat.usage.get(nom);
    if (compteur !== undefined) compteur.echecs += 1;
  }
  if (!etat.candidatsTentative.has(bloc.tool_use_id)) return;
  const texte = texteDeContenu(bloc.content);
  const reussie = !estErreur && texte.includes(' pass') && texte.includes('0 fail');
  etat.reussiteTentative.set(bloc.tool_use_id, reussie);
}

function traiterLigne(etat: EtatExtraction, ligne: LigneJsonl): void {
  enregistrerTimestamp(etat, ligne);
  enregistrerEnTete(etat, ligne);
  const contenu = ligne.message?.content;
  if (!Array.isArray(contenu)) return;
  const brut = typeof ligne.timestamp === 'string' ? Date.parse(ligne.timestamp) : NaN;
  const timestampLigne = Number.isNaN(brut) ? null : brut;
  // Forme non publiée par le SDK : chaque bloc est revérifié champ par champ ci-dessus.
  for (const bloc of contenu as BlocContenu[]) {
    traiterToolUse(etat, bloc, timestampLigne);
    traiterToolResult(etat, bloc);
  }
}

async function lireLignesBrutes(chemin: string): Promise<readonly string[]> {
  try {
    return (await readFile(chemin, 'utf8')).split('\n');
  } catch (erreur) {
    console.error(`[extraction-jsonl] transcript illisible ${chemin} :`, erreur);
    return [];
  }
}

async function lireEtTraiterLignes(chemin: string, etat: EtatExtraction): Promise<void> {
  const lignes = await lireLignesBrutes(chemin);
  for (let numero = 0; numero < lignes.length; numero += 1) {
    const ligneBrute = lignes[numero];
    if (ligneBrute === undefined || ligneBrute.length === 0) continue;
    try {
      // `JSON.parse` rend `any` ; le cast fixe seulement la forme attendue du JSONL du
      // CLI — chaque champ y est optionnel et revérifié par les fonctions en aval.
      traiterLigne(etat, JSON.parse(ligneBrute) as LigneJsonl);
    } catch (erreur) {
      console.error(`[extraction-jsonl] ligne ${numero + 1} illisible dans ${chemin}, ignorée :`, erreur);
    }
  }
}

function finaliserUsageOutils(usage: ReadonlyMap<string, CompteurOutil>): readonly UsageOutil[] {
  return [...usage.entries()].map(([nom, compteur]) => ({
    nom,
    appels: compteur.appels,
    echecs: compteur.echecs,
  }));
}

function finaliserTentatives(etat: EtatExtraction): readonly TentativeTest[] {
  return [...etat.candidatsTentative.entries()]
    .map(([id, candidat]) => ({ ...candidat, reussie: etat.reussiteTentative.get(id) ?? false }))
    .sort((a, b) => a.rang - b.rang);
}

function calculerTentativesAvantSucces(tentatives: readonly TentativeTest[]): number | null {
  return tentatives.find((tentative) => tentative.reussie)?.rang ?? null;
}

function extraireSessionId(chemin: string): string {
  const nomFichier = chemin.split(/[/\\]/).pop() ?? '';
  return nomFichier.replace(/\.jsonl$/, '');
}

function calculerDureeMs(etat: EtatExtraction): number {
  if (etat.premierTimestamp === null || etat.dernierTimestamp === null) return 0;
  return etat.dernierTimestamp - etat.premierTimestamp;
}

export async function extraireMesures(chemin: string): Promise<MesuresTranscript> {
  const etat = etatInitial();
  await lireEtTraiterLignes(chemin, etat);
  const tentatives = finaliserTentatives(etat);
  const tentativesAvantSucces = calculerTentativesAvantSucces(tentatives);
  const usageOutils = finaliserUsageOutils(etat.usage);
  return {
    sessionId: extraireSessionId(chemin),
    dureeMs: calculerDureeMs(etat),
    nbTours: etat.nbTours,
    usageOutils,
    appelsOutilsTotal: usageOutils.reduce((total, usage) => total + usage.appels, 0),
    tentatives,
    tentativesAvantSucces,
    reussiDuPremierCoup: tentativesAvantSucces === 1,
    modele: etat.modele,
  };
}

function tronquer(texte: string, max: number = TRONCATURE_TRACE): string {
  return texte.length > max ? `${texte.slice(0, max)}…` : texte;
}

function cheminDeEntree(input: BlocContenu['input']): string {
  if (input === undefined) return '';
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.path === 'string') return input.path;
  return '';
}

function ligneTraceDeBloc(bloc: BlocContenu): LigneTrace | null {
  if (bloc.type === 'tool_use' && typeof bloc.name === 'string') {
    const detail = typeof bloc.input?.command === 'string' ? bloc.input.command : cheminDeEntree(bloc.input);
    return { role: 'outil', outil: bloc.name, texte: tronquer(detail) };
  }
  if (bloc.type === 'tool_result' && bloc.is_error === true) {
    const premiereLigne = texteDeContenu(bloc.content).split('\n').find((l) => l.trim().length > 0) ?? '';
    return { role: 'resultat', outil: '', texte: tronquer(premiereLigne) };
  }
  if (bloc.type === 'text' && typeof bloc.text === 'string' && bloc.text.trim().length > 0) {
    return { role: 'texte', outil: '', texte: tronquer(bloc.text) };
  }
  return null;
}

function ajouterLignesDe(ligneBrute: string, sortie: LigneTrace[], max: number): void {
  let objet: LigneJsonl;
  try {
    // Même justification que dans `lireEtTraiterLignes` : forme du JSONL du CLI,
    // chaque champ optionnel et revérifié en aval (ici dans `ligneTraceDeBloc`).
    objet = JSON.parse(ligneBrute) as LigneJsonl;
  } catch (erreur) {
    console.error('[extraction-jsonl] ligne de trace illisible, ignorée :', erreur);
    return;
  }
  const contenu = objet.message?.content;
  if (!Array.isArray(contenu)) return;
  // Forme non publiée par le SDK : chaque bloc est revérifié champ par champ dans ligneTraceDeBloc.
  for (const bloc of contenu as BlocContenu[]) {
    if (sortie.length >= max) return;
    const trace = ligneTraceDeBloc(bloc);
    if (trace !== null) sortie.push(trace);
  }
}

/**
 * Rend les blocs saillants du transcript, dans l'ordre où ils apparaissent,
 * bornés par `options.max`.
 */
export async function extraireLignesTrace(
  chemin: string,
  options: { readonly max: number },
): Promise<readonly LigneTrace[]> {
  const lignes = await lireLignesBrutes(chemin);
  const sortie: LigneTrace[] = [];
  for (const ligneBrute of lignes) {
    if (sortie.length >= options.max) break;
    if (ligneBrute.length === 0) continue;
    ajouterLignesDe(ligneBrute, sortie, options.max);
  }
  return sortie;
}

function extraitCentre(ligne: string, position: number, longueurAiguille: number): string {
  const centre = position + Math.floor(longueurAiguille / 2);
  const debut = Math.max(0, centre - Math.floor(LARGEUR_EXTRAIT_INJECTION / 2));
  const fin = Math.min(ligne.length, debut + LARGEUR_EXTRAIT_INJECTION);
  return ligne.slice(debut, fin);
}

/**
 * Numéro (1-indexé) de la première ligne du JSONL brut contenant `aiguille`, et
 * un extrait de 400 caractères centré dessus. Preuve que la leçon est bien
 * entrée dans le contexte de l'équipe suivante — cherche dans le JSON brut, pas
 * dans une structure interprétée.
 */
export async function chercherInjection(
  chemin: string,
  aiguille: string,
): Promise<{ readonly ligneJsonl: number; readonly extrait: string } | null> {
  const lignes = await lireLignesBrutes(chemin);
  for (let numero = 0; numero < lignes.length; numero += 1) {
    const ligne = lignes[numero];
    if (ligne === undefined) continue;
    const position = ligne.indexOf(aiguille);
    if (position === -1) continue;
    return { ligneJsonl: numero + 1, extrait: extraitCentre(ligne, position, aiguille.length) };
  }
  return null;
}
