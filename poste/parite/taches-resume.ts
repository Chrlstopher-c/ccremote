// Responsabilité : présenter les tâches d'arrière-plan comme le panneau les montre — statut déduit quand le transcript
// n'a pas clos la tâche (sous-agent terminé, sortie figée depuis 10 min), liste récente, détail avec activité.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import {
  type DetailTacheParite,
  MAX_ACTIVITE,
  MAX_TACHES,
  type StatutTacheParite,
  type TacheParite,
} from '../../commun/parite.ts';
import type { EtatTranscript, TacheVue } from './etat.ts';
import { estAbsent, lireFin } from './fichier.ts';
import { lireEtat } from './lecture.ts';
import { blocs, estObjet, lireLigne, type Objet, texte } from './lignes.ts';

export const DELAI_SORTIE_FIGEE_MS = 10 * 60_000;
const OCTETS_FIN_SORTIE = 64 * 1024;
const OCTETS_FIN_AGENT = 256 * 1024;
const ACTIONS_RECENTES = 15;
const LIBELLE_MAX = 160;
const OUTILS_FICHIER = ['Edit', 'Write', 'Read', 'NotebookEdit'];
/** Sous-agents les plus récents dont on lit le journal pour y trouver leurs commandes de fond. */
const SOUS_AGENTS_LUS = 40;

interface StatutPresente {
  readonly statut: StatutTacheParite;
  readonly finLe: string | null;
}

export function tachesResumees(etat: EtatTranscript, transcript: string, journal: Logger): TacheParite[] {
  const maintenant = Date.now();
  return [...etat.taches.values(), ...commandesDesSousAgents(etat, transcript, journal)]
    .sort((a, b) => b.debutLe.localeCompare(a.debutLe))
    .slice(0, MAX_TACHES)
    .map((t) => resumerTache(t, transcript, maintenant, journal));
}

/**
 * Commandes lancées en arrière-plan par les sous-agents (Bash ou Monitor dans leur propre journal), comme Claude
 * Desktop les montre : le journal du fil principal ne les cite pas. Seuls les sous-agents les plus récents sont lus.
 */
export function commandesDesSousAgents(etat: EtatTranscript, transcript: string, journal: Logger): TacheVue[] {
  const dossier = dossierSousAgents(transcript);
  return [...etat.taches.values()]
    .filter((t) => t.genre === 'agent' && t.tacheId !== null)
    .sort((a, b) => b.debutLe.localeCompare(a.debutLe))
    .slice(0, SOUS_AGENTS_LUS)
    .flatMap((t) => {
      const sous = lireEtat(join(dossier, `agent-${t.tacheId}.jsonl`), journal);
      return sous === null ? [] : [...sous.taches.values()].filter((c) => c.genre === 'commande');
    });
}

/** Le détail d'une tâche (id = id du tool_use), ou null si ce transcript ne la connaît pas. */
export function detailTache(
  etat: EtatTranscript,
  id: string,
  transcript: string,
  journal: Logger,
): DetailTacheParite | null {
  const t = etat.taches.get(id) ?? commandesDesSousAgents(etat, transcript, journal).find((c) => c.id === id);
  if (!t) return null;
  return {
    ...resumerTache(t, transcript, Date.now(), journal),
    prompt: t.prompt,
    activite: activiteDe(t, transcript, journal),
  };
}

function resumerTache(t: TacheVue, transcript: string, maintenant: number, journal: Logger): TacheParite {
  const presente = statutPresente(t, transcript, maintenant, journal);
  return {
    id: t.id,
    genre: t.genre,
    description: t.description,
    statut: presente.statut,
    debutLe: t.debutLe,
    finLe: presente.finLe,
    modele: t.modele,
    tacheId: t.tacheId,
  };
}

function statutPresente(t: TacheVue, transcript: string, maintenant: number, journal: Logger): StatutPresente {
  if (t.notifiee) return { statut: t.statut, finLe: t.finLe };
  if (t.genre === 'agent') return statutAgentSansFin(t, transcript, maintenant, journal);
  if (t.echeance !== null) return statutAEcheance(t.echeance, maintenant);
  return statutCommandeSansFin(t, maintenant, journal) ?? { statut: 'en_cours', finLe: null };
}

// Monitor sans arrêt : en cours jusqu'à son échéance, arrêté à l'échéance (sa durée, timeout_ms).
function statutAEcheance(echeance: string, maintenant: number): StatutPresente {
  const fin = Date.parse(echeance);
  if (Number.isNaN(fin) || maintenant < fin) return { statut: 'en_cours', finLe: null };
  return { statut: 'arretee', finLe: echeance };
}

// Agent sans notification : terminé si son méta-fichier dit « finished » ; en cours si son journal a bougé depuis
// moins de 10 min ; sinon arrêté si la tâche a commencé il y a 10 min ou plus, en cours sinon.
// finLe : mtime du journal, sinon début de la tâche.
function statutAgentSansFin(t: TacheVue, transcript: string, maintenant: number, journal: Logger): StatutPresente {
  const dossier = dossierSousAgents(transcript);
  const identifiant = t.tacheId;
  const meta = identifiant === null ? null : lireMeta(join(dossier, `agent-${identifiant}.meta.json`), journal);
  const mtime = identifiant === null ? null : mtimeDe(join(dossier, `agent-${identifiant}.jsonl`), journal);
  const finLe = new Date(mtime ?? Date.parse(t.debutLe)).toISOString();
  if (meta?.['finished'] === true && !t.reprise) return { statut: 'terminee', finLe };
  if (mtime !== null && maintenant - mtime < DELAI_SORTIE_FIGEE_MS) return { statut: 'en_cours', finLe: null };
  const debut = Date.parse(t.debutLe);
  if (!Number.isNaN(debut) && maintenant - debut >= DELAI_SORTIE_FIGEE_MS) return { statut: 'arretee', finLe };
  return { statut: 'en_cours', finLe: null };
}

// Une commande dont la sortie n'a pas bougé depuis 10 min est arrêtée (son processus n'écrit plus rien).
function statutCommandeSansFin(t: TacheVue, maintenant: number, journal: Logger): StatutPresente | null {
  const repere = (t.sortie === null ? null : mtimeDe(t.sortie, journal)) ?? Date.parse(t.debutLe);
  if (Number.isNaN(repere) || maintenant - repere <= DELAI_SORTIE_FIGEE_MS) return null;
  return { statut: 'arretee', finLe: new Date(repere).toISOString() };
}

function activiteDe(t: TacheVue, transcript: string, journal: Logger): string | null {
  if (t.genre === 'commande') {
    if (t.sortie === null) return null;
    return enFin(lireFin(t.sortie, OCTETS_FIN_SORTIE, journal));
  }
  if (t.tacheId === null) return null;
  const journalAgent = lireFin(
    join(dossierSousAgents(transcript), `agent-${t.tacheId}.jsonl`),
    OCTETS_FIN_AGENT,
    journal,
  );
  return journalAgent === null ? null : actionsDe(journalAgent);
}

/** Les dernières actions du sous-agent : textes (première ligne) et appels d'outils « Outil : libellé ». */
export function actionsDe(brut: string): string | null {
  const actions = brut.split('\n').flatMap((l) => actionsDeLigne(lireLigne(l)));
  const recentes = actions.slice(-ACTIONS_RECENTES).join('\n');
  return recentes === '' ? null : recentes.slice(-MAX_ACTIVITE);
}

function actionsDeLigne(ligne: Objet | null): string[] {
  if (ligne === null || ligne['type'] !== 'assistant') return [];
  const message = ligne['message'];
  if (!estObjet(message)) return [];
  return blocs(message['content']).flatMap((bloc) => {
    const action = actionDe(bloc);
    return action === null ? [] : [action];
  });
}

function actionDe(bloc: Objet): string | null {
  if (bloc['type'] === 'text') {
    const premiere = (texte(bloc['text']) ?? '').split('\n').find((l) => l.trim() !== '') ?? '';
    return premiere.trim() === '' ? null : premiere.trim().slice(0, LIBELLE_MAX);
  }
  if (bloc['type'] !== 'tool_use') return null;
  const nom = texte(bloc['name']) ?? 'outil';
  const entree = estObjet(bloc['input']) ? bloc['input'] : {};
  return `${nom} : ${libelleDe(nom, entree)}`.slice(0, LIBELLE_MAX);
}

function libelleDe(nom: string, entree: Objet): string {
  const fichier = texte(entree['file_path']) ?? texte(entree['notebook_path']);
  if (OUTILS_FICHIER.includes(nom) && fichier !== null) return fichier;
  return texte(entree['description']) ?? texte(entree['command']) ?? '';
}

function enFin(texteFin: string | null): string | null {
  if (texteFin === null || texteFin.trim() === '') return null;
  return texteFin.slice(-MAX_ACTIVITE);
}

export function dossierSousAgents(transcript: string): string {
  return `${transcript.replace(/\.jsonl$/, '')}/subagents`;
}

export function lireMeta(chemin: string, journal: Logger): Objet | null {
  try {
    const brut: unknown = JSON.parse(readFileSync(chemin, 'utf8'));
    return estObjet(brut) ? brut : null;
  } catch (erreur) {
    if (!estAbsent(erreur)) journal.warn({ err: erreur, chemin }, 'méta-fichier de sous-agent illisible');
    return null;
  }
}

export function mtimeDe(chemin: string, journal: Logger): number | null {
  try {
    return statSync(chemin).mtimeMs;
  } catch (erreur) {
    if (!estAbsent(erreur)) journal.warn({ err: erreur, chemin }, 'date de fichier illisible');
    return null;
  }
}
