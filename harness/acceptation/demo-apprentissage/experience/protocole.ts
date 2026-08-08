/**
 * Responsabilité : le point d'entrée exécutable du protocole. Lance les cobayes,
 * une exécution à la fois, en ORDRE ENTRELACÉ entre conditions (jamais toutes les
 * répétitions d'une condition à la suite — ça isolerait un effet de dérive dans
 * le temps de l'effet de la leçon elle-même). Écrit le `FichierMesures` final.
 *
 * `☠` Aucune valeur de repli chiffrée : ce que le transcript ne permet pas
 * d'extraire vaut `null`, jamais une constante inventée.
 *
 * Usage : bun run experience/protocole.ts
 */

import { writeFile } from 'node:fs/promises';
import { query, type Options, type Query } from '@anthropic-ai/claude-agent-sdk';
import type { Condition, Execution, FichierMesures } from './contrat.ts';
import { CONDITIONS } from './contrat.ts';
import { mandatDe } from './mandat.ts';
import { preparerProjet, racineJetable } from './preparation.ts';
import { lireCommandeLivree, verifierCommande } from './verification.ts';
import { cheminTranscript, extraireMesures, type MesuresTranscript } from './extraction-jsonl.ts';
import { calculerAgregats, construireDescriptif, construireTraces } from './agregation.ts';

const REPETITIONS = Number(process.env['REPETITIONS'] ?? '5');
const MODELE = process.env['MODELE'] ?? 'sonnet';
const COMPTE = process.env['COMPTE'] ?? 'compte-a';
const SORTIE = process.env['SORTIE'] ?? 'harness/acceptation/demo-apprentissage/mesures.json';
const PLAFOND_MS = Number(process.env['PLAFOND_MS'] ?? '300000');
const BUDGET_USD = Number(process.env['BUDGET_USD'] ?? '1');
const CONFIG_DIR = `/home/trinity/.claude-comptes/${COMPTE}`;

/** L'invite est courte et IDENTIQUE pour tous les cobayes — seul le mandat varie. */
const INVITE = 'Exécute ton mandat.';

function analyserConditions(brut: string | undefined): readonly Condition[] {
  if (brut === undefined || brut.trim().length === 0) return CONDITIONS;
  const demandees = brut.split(',').map((c) => c.trim()).filter((c) => c.length > 0);
  const estCondition = (c: string): c is Condition => (CONDITIONS as readonly string[]).includes(c);
  const valides = demandees.filter(estCondition);
  const invalides = demandees.filter((c) => !estCondition(c));
  if (invalides.length > 0) {
    console.error(
      `[protocole] conditions ignorées (valeurs acceptées : ${CONDITIONS.join(', ')}) — reçu : ${invalides.join(', ')}`,
    );
  }
  return valides.length > 0 ? valides : CONDITIONS;
}

const CONDITIONS_DEMANDEES = analyserConditions(process.env['CONDITIONS']);

function construireOptions(condition: Condition, racine: string, sessionId: string, controleur: AbortController): Options {
  return {
    cwd: racine,
    model: MODELE,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: mandatDe(condition) },
    maxBudgetUsd: BUDGET_USD,
    sessionId,
    env: { ...process.env, CLAUDE_CONFIG_DIR: CONFIG_DIR },
    abortController: controleur,
    settingSources: [],
    mcpServers: {},
    disallowedTools: ['Task', 'WebFetch', 'WebSearch'],
  };
}

async function consommerFlux(flux: Query): Promise<number | null> {
  let coutUsd: number | null = null;
  for await (const message of flux) {
    if (message.type === 'result') coutUsd = message.total_cost_usd;
  }
  return coutUsd;
}

/** Lance un cobaye. N'abandonne le protocole entier sur aucune panne de session : loggue, rend un coût `null`. */
async function lancerAgent(condition: Condition, racine: string, sessionId: string): Promise<number | null> {
  const controleur = new AbortController();
  const options = construireOptions(condition, racine, sessionId, controleur);
  const minuterie = setTimeout(() => controleur.abort(), PLAFOND_MS);
  try {
    return await consommerFlux(query({ prompt: INVITE, options }));
  } catch (erreur) {
    console.error(`[protocole] échec de la session ${sessionId} (${condition}) :`, erreur);
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}

function assemblerExecution(
  condition: Condition,
  repetition: number,
  sessionId: string,
  transcript: string,
  demarreeA: string,
  coutUsd: number | null,
  mesures: MesuresTranscript,
  commandeLivree: string | null,
  succesVerifie: boolean,
): Execution {
  return {
    id: `${condition}-${repetition}-${sessionId}`,
    condition,
    repetition,
    sessionId,
    transcript,
    modele: mesures.modele,
    demarreeA,
    dureeMs: mesures.dureeMs,
    coutUsd,
    nbTours: mesures.nbTours,
    usageOutils: mesures.usageOutils,
    appelsOutilsTotal: mesures.appelsOutilsTotal,
    tentatives: mesures.tentatives,
    tentativesAvantSucces: mesures.tentativesAvantSucces,
    reussiDuPremierCoup: mesures.reussiDuPremierCoup,
    succesVerifie,
    commandeLivree,
  };
}

function journaliser(execution: Execution): void {
  console.log(
    `[${new Date().toISOString()}] ${execution.condition} rep=${execution.repetition} ` +
      `tentatives=${execution.tentatives.length} succesVerifie=${execution.succesVerifie} ` +
      `coutUsd=${execution.coutUsd ?? 'null'}`,
  );
}

async function executerRepetition(condition: Condition, repetition: number): Promise<Execution> {
  const sessionId = crypto.randomUUID();
  const racine = racineJetable(`${condition}-${repetition}-${sessionId.slice(0, 8)}`);
  try {
    await preparerProjet(racine);
  } catch (erreur) {
    console.error(`[protocole] échec de préparation du projet pour ${condition} rep=${repetition} :`, erreur);
    throw erreur;
  }
  const demarreeA = new Date().toISOString();
  const coutUsd = await lancerAgent(condition, racine, sessionId);
  const transcript = cheminTranscript(CONFIG_DIR, racine, sessionId);
  const mesures = await extraireMesures(transcript);
  const commandeLivree = await lireCommandeLivree(racine);
  const verif = commandeLivree === null ? { succes: false } : await verifierCommande(commandeLivree);
  return assemblerExecution(
    condition,
    repetition,
    sessionId,
    transcript,
    demarreeA,
    coutUsd,
    mesures,
    commandeLivree,
    verif.succes,
  );
}

/** Ordre ENTRELACÉ : répétition 1 de chaque condition, puis répétition 2, etc. */
async function executerToutesLesRepetitions(): Promise<Execution[]> {
  const executions: Execution[] = [];
  for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
    for (const condition of CONDITIONS_DEMANDEES) {
      const execution = await executerRepetition(condition, repetition);
      executions.push(execution);
      journaliser(execution);
    }
  }
  return executions;
}

async function ecrireResultats(executions: readonly Execution[]): Promise<void> {
  const agregats = calculerAgregats(CONDITIONS_DEMANDEES, executions);
  const traces = await construireTraces(executions);
  const fichier: FichierMesures = {
    version: 1,
    factice: false,
    raisonFactice: null,
    genereA: new Date().toISOString(),
    protocole: construireDescriptif(MODELE, REPETITIONS, CONDITIONS_DEMANDEES),
    executions,
    agregats,
    traces,
  };
  try {
    await writeFile(SORTIE, JSON.stringify(fichier, null, 2), 'utf8');
  } catch (erreur) {
    console.error(`[protocole] échec d'écriture de ${SORTIE} :`, erreur);
    throw erreur;
  }
  console.log(`[protocole] mesures écrites dans ${SORTIE}`);
}

async function main(): Promise<void> {
  console.log(
    `[protocole] démarrage · modele=${MODELE} compte=${COMPTE} repetitions=${REPETITIONS} ` +
      `conditions=${CONDITIONS_DEMANDEES.join(',')} plafondMs=${PLAFOND_MS} budgetUsd=${BUDGET_USD}`,
  );
  const executions = await executerToutesLesRepetitions();
  await ecrireResultats(executions);
}

await main();
