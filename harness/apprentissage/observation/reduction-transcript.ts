/**
 * Responsabilité : réduction déterministe d'un transcript JSONL en `ResumeMission`
 * (C-1, SPEC-APPRENTISSAGE.md §5) — pure vis-à-vis d'une écriture, sans modèle, sans
 * réseau. C'est la brique qui rend le reste finançable : un 8B ne verra jamais autre
 * chose que sa sortie, bornée quelle que soit la taille du transcript source.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { journal } from '../logger.ts';
import type { IssueMission, ResumeMission, SousAgentResume, UsageOutil } from '../types.ts';
import { lireTranscriptEnFlux, type LigneTranscriptBrute } from './lecture-jsonl.ts';

const MAX_ERREURS = 10;
const MAX_FICHIERS = 30;
const MAX_COMMANDES_ECHOUEES = 10;
const MAX_EXTRAIT_FINAL = 1_500;
const MAX_MANDAT_RESUME = 400;
const MAX_LONGUEUR_LIGNE_ERREUR = 300;
const NOMS_OUTILS_FICHIER = new Set(['Write', 'Edit', 'NotebookEdit']);

export interface ParametresReduction {
  readonly missionId: string;
  /** Chemin du dépôt, pas le worktree — vient du registre, pas du transcript. */
  readonly projet: string;
  readonly mandat: string | null;
  readonly critereArret: string | null;
  /** Décidé par C-2 (`classerIssue`) ; C-1 ne juge jamais l'issue lui-même. */
  readonly issue: IssueMission;
  readonly cheminTranscript: string;
}

interface CompteurOutil {
  appels: number;
  echecs: number;
}

interface InfoToolUse {
  readonly nom: string;
  readonly input: unknown;
}

interface Accumulateur {
  sessionId: string | null;
  premierTimestamp: number | null;
  dernierTimestamp: number | null;
  nbTours: number;
  readonly outilsParId: Map<string, InfoToolUse>;
  readonly outils: Map<string, CompteurOutil>;
  readonly erreurs: string[];
  readonly erreursVues: Set<string>;
  readonly fichiersTouches: Set<string>;
  readonly commandesEchouees: string[];
  extraitFinal: string | null;
}

function nouvelAccumulateur(): Accumulateur {
  return {
    sessionId: null,
    premierTimestamp: null,
    dernierTimestamp: null,
    nbTours: 0,
    outilsParId: new Map(),
    outils: new Map(),
    erreurs: [],
    erreursVues: new Set(),
    fichiersTouches: new Set(),
    commandesEchouees: [],
    extraitFinal: null,
  };
}

function tronquer(texte: string, max: number): string {
  return texte.length > max ? `${texte.slice(0, max)}…` : texte;
}

function texteDeContenu(contenu: unknown): string {
  if (typeof contenu === 'string') return contenu;
  if (!Array.isArray(contenu)) return '';
  return contenu
    .filter((b): b is { text: string } => b !== null && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string')
    .map((b) => b.text)
    .join(' ');
}

function extraireCodeSortie(texte: string): number | null {
  const trouve = /exit code[:\s]+(-?\d+)/i.exec(texte);
  if (trouve === null) return null;
  const code = Number(trouve[1]);
  return Number.isNaN(code) ? null : code;
}

function extraireChampTexte(input: unknown, champ: string): string | null {
  if (input === null || typeof input !== 'object') return null;
  const valeur = (input as Record<string, unknown>)[champ];
  return typeof valeur === 'string' ? valeur : null;
}

function majTimestamp(acc: Accumulateur, timestamp: string | undefined): void {
  if (timestamp === undefined) return;
  const valeur = Date.parse(timestamp);
  if (Number.isNaN(valeur)) return;
  if (acc.premierTimestamp === null || valeur < acc.premierTimestamp) acc.premierTimestamp = valeur;
  if (acc.dernierTimestamp === null || valeur > acc.dernierTimestamp) acc.dernierTimestamp = valeur;
}

function incrementerAppel(acc: Accumulateur, nom: string): void {
  const compteur = acc.outils.get(nom) ?? { appels: 0, echecs: 0 };
  compteur.appels += 1;
  acc.outils.set(nom, compteur);
}

function incrementerEchec(acc: Accumulateur, nom: string): void {
  const compteur = acc.outils.get(nom) ?? { appels: 0, echecs: 0 };
  compteur.echecs += 1;
  acc.outils.set(nom, compteur);
}

function ajouterErreur(acc: Accumulateur, texte: string): void {
  const normalise = tronquer(texte.replace(/\s+/g, ' ').trim(), MAX_LONGUEUR_LIGNE_ERREUR);
  if (normalise.length === 0 || acc.erreursVues.has(normalise) || acc.erreurs.length >= MAX_ERREURS) return;
  acc.erreursVues.add(normalise);
  acc.erreurs.push(normalise);
}

function ajouterFichierTouche(acc: Accumulateur, projet: string, cheminFichier: string): void {
  if (acc.fichiersTouches.size >= MAX_FICHIERS) return;
  acc.fichiersTouches.add(relative(projet, cheminFichier));
}

function ajouterCommandeEchouee(acc: Accumulateur, commande: string, texteResultat: string): void {
  if (acc.commandesEchouees.length >= MAX_COMMANDES_ECHOUEES) return;
  const code = extraireCodeSortie(texteResultat);
  const libelle = code === null ? `${commande} (échec)` : `${commande} (code ${code})`;
  acc.commandesEchouees.push(tronquer(libelle, MAX_LONGUEUR_LIGNE_ERREUR));
}

/** Traite les blocs d'un message `assistant` : tours, appels d'outils, extrait final. */
function traiterBlocsAssistant(acc: Accumulateur, projet: string, contenu: unknown): void {
  if (!Array.isArray(contenu)) return;
  for (const bloc of contenu) {
    if (bloc === null || typeof bloc !== 'object') continue;
    const b = bloc as { type?: string; text?: string; name?: string; id?: string; input?: unknown };
    if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
      acc.extraitFinal = b.text;
    } else if (b.type === 'tool_use' && typeof b.name === 'string' && typeof b.id === 'string') {
      acc.outilsParId.set(b.id, { nom: b.name, input: b.input });
      incrementerAppel(acc, b.name);
      if (NOMS_OUTILS_FICHIER.has(b.name)) {
        const cheminFichier = extraireChampTexte(b.input, 'file_path');
        if (cheminFichier !== null) ajouterFichierTouche(acc, projet, cheminFichier);
      }
    }
  }
}

/** Traite les blocs d'un message `user` : uniquement les `tool_result` en échec. */
function traiterBlocsUser(acc: Accumulateur, contenu: unknown): void {
  if (!Array.isArray(contenu)) return;
  for (const bloc of contenu) {
    if (bloc === null || typeof bloc !== 'object') continue;
    const b = bloc as { type?: string; tool_use_id?: string; is_error?: boolean; content?: unknown };
    if (b.type !== 'tool_result' || b.is_error !== true) continue;
    const info = typeof b.tool_use_id === 'string' ? (acc.outilsParId.get(b.tool_use_id) ?? null) : null;
    incrementerEchec(acc, info?.nom ?? 'inconnu');
    const texteResultat = texteDeContenu(b.content);
    ajouterErreur(acc, texteResultat);
    if (info?.nom === 'Bash') {
      const commande = extraireChampTexte(info.input, 'command');
      if (commande !== null) ajouterCommandeEchouee(acc, commande, texteResultat);
    }
  }
}

/**
 * Traite une ligne de transcript. `☠` Les lignes `isSidechain: true` sont exclues des
 * tours/outils du fil principal : elles appartiennent à un sous-agent, déjà couvert par
 * `sousAgents` (fichiers séparés, SPEC F-1) — les compter ici doublerait le travail.
 */
function traiterLigne(acc: Accumulateur, ligne: LigneTranscriptBrute, projet: string): void {
  majTimestamp(acc, ligne.timestamp);
  if (acc.sessionId === null && ligne.sessionId !== undefined) acc.sessionId = ligne.sessionId;
  if (ligne.isSidechain === true) return;
  const contenu = ligne.message?.content;
  if (ligne.type === 'assistant') {
    acc.nbTours += 1;
    traiterBlocsAssistant(acc, projet, contenu);
  } else if (ligne.type === 'user') {
    traiterBlocsUser(acc, contenu);
  }
  // Tout autre `type` (queue-operation, attachment, ai-title, last-prompt, summary…)
  // est ignoré sans lever — spec §2 F-2 : le lecteur doit tolérer les types inconnus.
}

interface MetaSousAgentBrute {
  readonly agentType?: string;
  readonly description?: string;
}

/**
 * Lit `<sessionId>/subagents/*.meta.json`, sans jamais lever : dossier absent (mission
 * sans sous-agent, régime nominal) ou fichier illisible rendent une liste vide/partielle.
 */
async function lireSousAgentsResume(cheminTranscript: string, sessionId: string): Promise<readonly SousAgentResume[]> {
  const dossier = join(dirname(cheminTranscript), sessionId, 'subagents');
  let fichiers: readonly string[];
  try {
    fichiers = await readdir(dossier);
  } catch {
    return [];
  }
  const resumes: SousAgentResume[] = [];
  for (const fichier of fichiers) {
    if (!fichier.endsWith('.meta.json')) continue;
    try {
      const brut = JSON.parse(await readFile(join(dossier, fichier), 'utf8')) as MetaSousAgentBrute;
      resumes.push({ type: brut.agentType ?? null, description: brut.description ?? null });
    } catch (erreur) {
      journal.debug({ err: erreur, fichier }, 'meta de sous-agent illisible — les autres sont rendus');
    }
  }
  return resumes;
}

function construireResumeMission(
  parametres: ParametresReduction,
  acc: Accumulateur,
  sousAgents: readonly SousAgentResume[],
): ResumeMission {
  const dureeMs =
    acc.premierTimestamp !== null && acc.dernierTimestamp !== null
      ? Math.max(0, acc.dernierTimestamp - acc.premierTimestamp)
      : 0;
  const outils: readonly UsageOutil[] = [...acc.outils.entries()]
    .map(([nom, compteurs]) => ({ nom, appels: compteurs.appels, echecs: compteurs.echecs }))
    .sort((a, b) => b.appels - a.appels);
  return {
    missionId: parametres.missionId,
    sessionId: acc.sessionId ?? parametres.missionId,
    projet: parametres.projet,
    mandatResume: tronquer(parametres.mandat ?? '', MAX_MANDAT_RESUME),
    critereArret: parametres.critereArret,
    issue: parametres.issue,
    dureeMs,
    nbTours: acc.nbTours,
    outils,
    erreurs: acc.erreurs,
    fichiersTouches: [...acc.fichiersTouches].sort().slice(0, MAX_FICHIERS),
    commandesEchouees: acc.commandesEchouees,
    sousAgents,
    extraitFinal: tronquer(acc.extraitFinal ?? '', MAX_EXTRAIT_FINAL),
  };
}

/**
 * Réduit un transcript JSONL réel en `ResumeMission` borné. Lecture en flux (jamais le
 * fichier entier en mémoire) ; les lignes illisibles sont comptées et journalisées, jamais
 * levées.
 */
export async function reduireTranscript(parametres: ParametresReduction): Promise<ResumeMission> {
  const acc = nouvelAccumulateur();
  const { lignesIllisibles } = await lireTranscriptEnFlux(parametres.cheminTranscript, (ligne) =>
    traiterLigne(acc, ligne, parametres.projet),
  );
  if (lignesIllisibles > 0) {
    journal.warn(
      { cheminTranscript: parametres.cheminTranscript, lignesIllisibles },
      'lignes de transcript illisibles ignorées',
    );
  }
  const sousAgents = await lireSousAgentsResume(parametres.cheminTranscript, acc.sessionId ?? parametres.missionId);
  return construireResumeMission(parametres, acc, sousAgents);
}

/**
 * Estimation grossière du nombre de tokens d'un `ResumeMission` sérialisé (~4 caractères
 * par token, heuristique documentée — voir bornes SPEC §5.1 : sous 2 000 tokens toujours).
 */
export function estimerTokensResumeMission(resume: ResumeMission): number {
  return Math.ceil(JSON.stringify(resume).length / 4);
}
