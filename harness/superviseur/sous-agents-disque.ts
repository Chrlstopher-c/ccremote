/**
 * Responsabilité : établir, depuis le DISQUE, la liste des sous-agents d'une
 * session et ce que chacun produit. C'est la source de COMPLÉTUDE de H-72.3.
 *
 * `☠` Pourquoi pas le flux : mesuré (H-72.4), `forwardSubagentText` est non
 * déterministe — 0 à 4 lignes reçues sur 5 sous-agents réellement lancés, deux
 * fois de suite sur une session saine. Bâtir la liste dessus, c'est afficher un
 * parc d'équipe qui varie d'un rafraîchissement à l'autre. Le disque, lui, est
 * l'autorité (H.3.1) : un sous-agent qui a tourné a son fichier, point.
 *
 * `☠ TROUVÉ EN INSPECTANT UN ARTEFACT RÉEL (23/07)` — le CLI écrit, à côté de
 * chaque transcript de sous-agent, un `agent-<id>.meta.json` qui porte
 * `{agentType, description, toolUseId, spawnDepth}`. Ce `toolUseId` est
 * EXACTEMENT l'identifiant que le flux utilise (`parent_tool_use_id`) : la
 * corrélation flux ⟷ store, documentée comme impossible avec les types publics
 * du SDK (`observabilite/types.ts`), existe donc bel et bien sur disque. On la
 * remonte plutôt que de la deviner — mais on ne DÉPEND pas d'elle : un sous-agent
 * sans meta lisible est rendu quand même, avec ce qu'on sait de lui.
 *
 * Disposition réelle vérifiée sur le disque du PC :
 *   <configDir>/projects/<cwd avec / → ->/<sessionId>/subagents/agent-<id>.jsonl
 *                                                              agent-<id>.meta.json
 */

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { superviseurLogger } from './logger.ts';

const log = superviseurLogger.child({ composant: 'sous-agents-disque' });

/** Au-delà, un sous-agent sans nouvelle ligne est tenu pour terminé, pas actif. */
const INACTIVITE_TERMINE_MS = 60_000;

/** Le fil rendu par sous-agent : de quoi voir ce qu'il fait, jamais son contexte brut. */
const MAX_ACTIVITES_PAR_AGENT = 40;

export interface ActiviteSousAgent {
  readonly texte: string;
  readonly survenuA: number;
  readonly type: 'texte' | 'reflexion' | 'outil';
  readonly outil: string | null;
}

export interface SousAgentObserve {
  readonly agentId: string;
  /** `general-purpose`, `Explore`… — tel que le CLI l'a écrit, jamais deviné. */
  readonly type: string | null;
  /** Description donnée au dispatch (« Compter de 1 à 20 »). */
  readonly description: string | null;
  /** `parent_tool_use_id` côté flux — le pont flux ⟷ store (voir l'en-tête). */
  readonly toolUseId: string | null;
  readonly profondeur: number;
  readonly statut: 'actif' | 'termine';
  /** Dernier texte produit, tronqué court. `null` si rien de lisible. */
  readonly derniereAction: string | null;
  readonly majA: number;
  readonly activites: readonly ActiviteSousAgent[];
}

/**
 * Clé de projet du CLI : chemin absolu du cwd, séparateurs remplacés par des
 * tirets. Dupliquée depuis `composition/pi/verificateur-session-sdk.ts` à
 * dessein : les deux vivent dans des domaines distincts (superviseur PC vs
 * control plane Pi) et n'ont aucune raison de changer ensemble — une
 * mutualisation les coupleraient sans bénéfice (duplication accidentelle).
 */
function cleProjet(cwd: string): string {
  return cwd.replace(/[/\\]/g, '-');
}

export function dossierSousAgents(sessionId: string, cwd: string, configDir?: string): string {
  const racine = configDir ?? join(homedir(), '.claude');
  return join(racine, 'projects', cleProjet(cwd), sessionId, 'subagents');
}

/**
 * Les dossiers à essayer, dans l'ordre.
 *
 * `☠ LE CLI ÉCRIT SOUS LE CHEMIN RÉEL, LE HARNESS CHERCHAIT SOUS LE LIEN` (03/08).
 * Sur le VPS, `/mnt/projects` est un lien symbolique vers `~/dev` : le worker est
 * lancé avec `cwd=/mnt/projects/bac-a-sable`, mais le CLI résout le realpath et
 * range ses transcripts sous `-home-ubuntu-dev-bac-a-sable`. Le harness calculait
 * `-mnt-projects-bac-a-sable`, un dossier qui n'existe sur aucune machine — donc
 * ZÉRO sous-agent remonté, en silence, depuis la bascule multi-machines.
 * Mesuré sur la mission `acbb7465` : sept transcrits sur le disque, autant de
 * `.meta.json` lisibles, et « sous-agents : aucun » à l'écran pendant dix minutes.
 * Les deux clés sont essayées : le PC (sans lien) tombe sur la première, le VPS
 * sur la seconde, et aucune des deux machines ne dépend de la topologie de l'autre.
 */
async function dossiersCandidats(sessionId: string, cwd: string, configDir?: string): Promise<readonly string[]> {
  const candidats = [dossierSousAgents(sessionId, cwd, configDir)];
  try {
    const reel = await realpath(cwd);
    if (reel !== cwd) candidats.push(dossierSousAgents(sessionId, reel, configDir));
  } catch {
    // `cwd` disparu (worktree supprimé) : la clé brute reste le meilleur essai.
  }
  return candidats;
}

interface MetaBrute {
  readonly agentType?: string;
  readonly description?: string;
  readonly toolUseId?: string;
  readonly spawnDepth?: number;
}

interface LigneTranscript {
  readonly type?: string;
  readonly timestamp?: string;
  readonly message?: { readonly content?: unknown };
}

function texteEtOutils(contenu: unknown): readonly Omit<ActiviteSousAgent, 'survenuA'>[] {
  if (typeof contenu === 'string') return [{ texte: contenu, type: 'texte', outil: null }];
  if (!Array.isArray(contenu)) return [];
  const sorties: Omit<ActiviteSousAgent, 'survenuA'>[] = [];
  for (const bloc of contenu) {
    if (bloc === null || typeof bloc !== 'object') continue;
    const b = bloc as { type?: string; text?: string; thinking?: string; name?: string };
    if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
      sorties.push({ texte: b.text, type: 'texte', outil: null });
    } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.length > 0) {
      sorties.push({ texte: b.thinking, type: 'reflexion', outil: null });
    } else if (b.type === 'tool_use' && typeof b.name === 'string') {
      sorties.push({ texte: b.name, type: 'outil', outil: b.name });
    }
  }
  return sorties;
}

/**
 * Lit le transcript d'un sous-agent. `☠` Ne lève jamais : un fichier en cours
 * d'écriture peut avoir une dernière ligne tronquée — on saute la ligne, on ne
 * perd pas l'agent.
 */
async function lireActivites(chemin: string): Promise<readonly ActiviteSousAgent[]> {
  const brut = await readFile(chemin, 'utf8');
  const activites: ActiviteSousAgent[] = [];
  for (const ligne of brut.split('\n')) {
    if (ligne.length === 0) continue;
    let objet: LigneTranscript;
    try {
      objet = JSON.parse(ligne) as LigneTranscript;
    } catch {
      continue; // Ligne tronquée : le CLI écrit pendant qu'on lit.
    }
    if (objet.type !== 'assistant') continue;
    const survenuA = objet.timestamp === undefined ? Date.now() : Date.parse(objet.timestamp);
    for (const sortie of texteEtOutils(objet.message?.content)) {
      activites.push({ ...sortie, survenuA: Number.isNaN(survenuA) ? Date.now() : survenuA });
    }
  }
  return activites.slice(-MAX_ACTIVITES_PAR_AGENT);
}

async function lireMeta(chemin: string): Promise<MetaBrute> {
  try {
    return JSON.parse(await readFile(chemin, 'utf8')) as MetaBrute;
  } catch {
    // Meta absente ou illisible : l'agent existe quand même, il sera rendu sans
    // son type ni sa description — jamais omis (H-72.4).
    return {};
  }
}

/** Dernier texte lisible, tronqué. Une réflexion vaut mieux que rien à afficher. */
function derniereActionDe(activites: readonly ActiviteSousAgent[]): string | null {
  const dernier = [...activites].reverse().find((a) => a.type !== 'outil') ?? activites[activites.length - 1];
  if (dernier === undefined) return null;
  const texte = dernier.type === 'outil' ? `outil ${dernier.texte}` : dernier.texte;
  return texte.length > 180 ? `${texte.slice(0, 180)}…` : texte;
}

/**
 * Liste les sous-agents d'une session, avec ce que chacun a produit.
 *
 * Ne lève JAMAIS : une session sans sous-agent, un dossier absent (le CLI ne le
 * crée qu'au premier dispatch) ou un fichier illisible rendent une liste vide ou
 * partielle — jamais une exception qui priverait la mission de sa télémétrie.
 */
export async function lireSousAgents(
  sessionId: string,
  cwd: string,
  configDir?: string,
  maintenant: number = Date.now(),
): Promise<readonly SousAgentObserve[]> {
  let dossier: string | null = null;
  let fichiers: readonly string[] = [];
  for (const candidat of await dossiersCandidats(sessionId, cwd, configDir)) {
    try {
      fichiers = await readdir(candidat);
      dossier = candidat;
      break;
    } catch {
      // Dossier absent sous cette clé : on essaie la suivante (lien symbolique).
    }
  }
  // Aucun sous-agent dispatché, sous aucune clé : régime nominal, pas une panne.
  if (dossier === null) return [];
  const observes: SousAgentObserve[] = [];
  for (const fichier of fichiers) {
    if (!fichier.endsWith('.jsonl')) continue;
    const agentId = fichier.replace(/^agent-/, '').replace(/\.jsonl$/, '');
    try {
      const chemin = join(dossier, fichier);
      const [meta, activites, infos] = await Promise.all([
        lireMeta(join(dossier, fichier.replace(/\.jsonl$/, '.meta.json'))),
        lireActivites(chemin),
        stat(chemin),
      ]);
      // `☠` L'horodatage du DERNIER MESSAGE prime sur le `mtime` du fichier, et
      // ne se combine pas avec lui : un `max()` des deux rend « actif » tout
      // agent dont le fichier vient d'être touché (copie, restauration,
      // rsync…) alors que son travail date d'hier. Le mtime ne sert que
      // lorsqu'aucun message n'est lisible — c'est alors le seul signal restant.
      const majA = activites[activites.length - 1]?.survenuA ?? infos.mtimeMs;
      observes.push({
        agentId,
        type: meta.agentType ?? null,
        description: meta.description ?? null,
        toolUseId: meta.toolUseId ?? null,
        profondeur: meta.spawnDepth ?? 1,
        // `☠` Le disque ne dit pas « terminé » explicitement : on le déduit du
        // silence. Un sous-agent qui réfléchit longtemps sera dit « terminé » à
        // tort plutôt que l'inverse — un faux « actif » laisserait croire à une
        // équipe qui travaille alors que plus rien ne tourne.
        statut: maintenant - majA > INACTIVITE_TERMINE_MS ? 'termine' : 'actif',
        derniereAction: derniereActionDe(activites),
        majA,
        activites,
      });
    } catch (erreur) {
      log.debug({ err: erreur, agentId }, 'sous-agent illisible — les autres sont rendus');
    }
  }
  return observes.sort((a, b) => a.majA - b.majA);
}
