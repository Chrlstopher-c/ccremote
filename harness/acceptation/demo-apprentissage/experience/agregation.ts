/**
 * Responsabilité : dériver `AgregatCondition[]` et `Traces` des `Execution[]`
 * mesurées, et assembler le `DescriptifProtocole` statique. Rien ici n'est une
 * mesure nouvelle — uniquement des calculs sur ce que `extraction-jsonl.ts` a
 * déjà extrait, ou du texte repris mot pour mot depuis `mandat.ts`.
 */

import type { AgregatCondition, Condition, DescriptifProtocole, Execution, Traces } from './contrat.ts';
import { BLOCS_LECONS, LECON_DU_PIEGE, LIMITES, MANDAT_COMMUN } from './mandat.ts';
import { chercherInjection, extraireLignesTrace } from './extraction-jsonl.ts';

/** Cap d'affichage des extraits de trace — jamais une mesure, juste une borne d'UI. */
const MAX_LIGNES_TRACE = 30;
/**
 * `☠ MESURÉ le 2026-08-08` — le mandat système (`systemPrompt.append`) n'est PAS
 * réécrit dans le transcript JSONL : y chercher le texte de la leçon ne trouve rien.
 * Ce qu'on y trouve, et qui prouve mieux, c'est la VALEUR que seule la leçon
 * transportait — le jeton du banc. Aucune lecture du projet ne peut la produire :
 * si elle apparaît dans le transcript d'une équipe, elle est entrée par le mandat,
 * et par nulle autre voie.
 */
export const AIGUILLE_INJECTION = 'ARDOISE-7719';

const PIEGE_DECRIT =
  'La suite de tests ne passe que si `banc/amorce.ts` est préchargé ' +
  '(`bun test --preload ./banc/amorce.ts`). Sans ce préchargement, la table de taux est ' +
  "absente et l'erreur remonte depuis `src/tarif.ts` — une fausse piste côté code métier, " +
  'alors que le code métier est correct.';

const TACHE_DECRITE =
  'Trouver, sans modifier le projet, la commande qui fait passer les 3 tests de la suite, ' +
  'et la consigner dans `COMMANDE.md`.';

const CRITERE_SUCCES =
  '`COMMANDE.md` contient une commande qui, rejouée sur une copie neuve du projet, fait ' +
  "passer les 3 tests — vérifié par un vérificateur externe, indépendant de toute " +
  "déclaration de l'agent.";

function mediane(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  return triees[Math.floor((triees.length - 1) / 2)] ?? null;
}

function moyenne(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  return valeurs.reduce((total, valeur) => total + valeur, 0) / valeurs.length;
}

function estNombre(valeur: number | null): valeur is number {
  return valeur !== null;
}

function calculerAgregatCondition(condition: Condition, executions: readonly Execution[]): AgregatCondition {
  const dExecutions = executions.filter((execution) => execution.condition === condition);
  const tentativesReussies = dExecutions.map((e) => e.tentativesAvantSucces).filter(estNombre);
  const couts = dExecutions.map((e) => e.coutUsd).filter(estNombre);
  return {
    condition,
    executions: dExecutions.length,
    succesVerifie: dExecutions.filter((e) => e.succesVerifie).length,
    reussiDuPremierCoup: dExecutions.filter((e) => e.reussiDuPremierCoup).length,
    tentativesMediane: mediane(tentativesReussies),
    tentativesMoyenne: moyenne(tentativesReussies),
    dureeMedianeMs: mediane(dExecutions.map((e) => e.dureeMs)) ?? 0,
    coutMoyenUsd: moyenne(couts),
    appelsOutilsMoyens: moyenne(dExecutions.map((e) => e.appelsOutilsTotal)) ?? 0,
  };
}

export function calculerAgregats(
  conditions: readonly Condition[],
  executions: readonly Execution[],
): readonly AgregatCondition[] {
  return conditions.map((condition) => calculerAgregatCondition(condition, executions));
}

async function traceInjection(executions: readonly Execution[]): Promise<Traces['injection']> {
  const cible = executions.find((e) => e.condition === 'avec_lecon' && e.succesVerifie);
  if (cible === undefined) return null;
  const aiguille = AIGUILLE_INJECTION;
  const trouve = await chercherInjection(cible.transcript, aiguille);
  return trouve === null ? null : { transcript: cible.transcript, ...trouve };
}

async function traceTatonnement(executions: readonly Execution[]): Promise<Traces['tatonnement']> {
  const candidats = executions.filter((e) => e.condition === 'sans_lecon');
  if (candidats.length === 0) return null;
  const premier = candidats[0];
  if (premier === undefined) return null;
  const cible = candidats.reduce((max, e) => (e.tentatives.length > max.tentatives.length ? e : max), premier);
  const lignes = await extraireLignesTrace(cible.transcript, { max: MAX_LIGNES_TRACE });
  return { transcript: cible.transcript, lignes };
}

async function traceDirect(executions: readonly Execution[]): Promise<Traces['direct']> {
  const cible = executions.find((e) => e.condition === 'avec_lecon' && e.reussiDuPremierCoup);
  if (cible === undefined) return null;
  const lignes = await extraireLignesTrace(cible.transcript, { max: MAX_LIGNES_TRACE });
  return { transcript: cible.transcript, lignes };
}

/**
 * Assemble les traces réelles affichées par la page. Chaque fonction sous-jacente
 * (`chercherInjection`, `extraireLignesTrace`) ne lève jamais — un échec de
 * lecture y rend un résultat vide, jamais une exception ici.
 */
export async function construireTraces(executions: readonly Execution[]): Promise<Traces> {
  const [injection, tatonnement, direct] = await Promise.all([
    traceInjection(executions),
    traceTatonnement(executions),
    traceDirect(executions),
  ]);
  return { leconMotPourMot: LECON_DU_PIEGE, injection, tatonnement, direct };
}

/** Description du protocole, reprise telle quelle par la page. */
export function construireDescriptif(
  modele: string,
  repetitionsParCondition: number,
  conditions: readonly Condition[],
): DescriptifProtocole {
  return {
    modele,
    repetitionsParCondition,
    conditions,
    piege: PIEGE_DECRIT,
    tache: TACHE_DECRITE,
    mandatMotPourMot: MANDAT_COMMUN,
    blocsLecons: BLOCS_LECONS,
    critereSucces: CRITERE_SUCCES,
    limites: LIMITES,
  };
}
