// Responsabilité : le fil complet d'un sous-agent (son transcript JSONL traduit comme le fil principal), pour la vue
// détaillée d'une tâche. Lecture seule ; le transcript du sous-agent est la seule source. Les événements
// marqués `agent` sont rendus sans cette marque : le fil de l'appli les affiche à plat.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { type FilTacheParite } from '../../commun/parite.ts';
import type { Evenement } from '../../commun/session.ts';
import { traduire } from '../session/traduction.ts';
import { estAbsent } from './fichier.ts';
import { blocs, estObjet, lireLigne, type Objet, texte } from './lignes.ts';
import { DELAI_SORTIE_FIGEE_MS, dossierSousAgents, lireMeta, mtimeDe } from './taches-resume.ts';

const MAX_EVENEMENTS = 2000;
const DELAI_FIN_MS = 30_000;
const PREFIXE_AGENT = 'agent-';
const SUFFIXE_META = '.meta.json';
const IDENTIFIANT_INTERDIT = /[/\\]|\.\./;

interface EntreeFil {
  readonly ts: string;
  readonly evt: Evenement;
}

/** Le fil du sous-agent `tache` (identifiant d'agent, ou id du tool_use qui l'a lancé), ou null si introuvable. */
export function filTache(transcript: string, tache: string, journal: Logger): FilTacheParite | null {
  if (tache === '' || IDENTIFIANT_INTERDIT.test(tache)) return null;
  const dossier = dossierSousAgents(transcript);
  const agent = agentDe(dossier, tache, journal);
  if (agent === null) return null;
  const chemin = join(dossier, `${PREFIXE_AGENT}${agent}.jsonl`);
  const brut = lireJournal(chemin, journal);
  if (brut === null) return null;
  const meta = lireMeta(join(dossier, `${PREFIXE_AGENT}${agent}${SUFFIXE_META}`), journal);
  const termine = termineDe(meta, mtimeDe(chemin, journal), Date.now());
  const entrees = evenementsDe(brut, agent, journal);
  const garde = gardees(entrees);
  return {
    agent,
    description: texte(meta?.['description']),
    modele: texte(meta?.['model']),
    termine,
    evenements: termine ? [...garde, tourFini(entrees)] : garde,
  };
}

function agentDe(dossier: string, tache: string, journal: Logger): string | null {
  if (existsSync(join(dossier, `${PREFIXE_AGENT}${tache}.jsonl`))) return tache;
  for (const nom of lireDossier(dossier, journal)) {
    if (!nom.startsWith(PREFIXE_AGENT) || !nom.endsWith(SUFFIXE_META)) continue;
    const meta = lireMeta(join(dossier, nom), journal);
    if (meta?.['toolUseId'] === tache) return nom.slice(PREFIXE_AGENT.length, -SUFFIXE_META.length);
  }
  return null;
}

function lireDossier(dossier: string, journal: Logger): string[] {
  try {
    return readdirSync(dossier);
  } catch (erreur) {
    if (!estAbsent(erreur)) journal.warn({ err: erreur, dossier }, 'dossier de sous-agents illisible');
    return [];
  }
}

function lireJournal(chemin: string, journal: Logger): string | null {
  try {
    return readFileSync(chemin, 'utf8');
  } catch (erreur) {
    if (!estAbsent(erreur)) journal.warn({ err: erreur, chemin }, 'journal de sous-agent illisible');
    return null;
  }
}

// Sous-agent terminé (méta « finished », journal calme depuis 30 s) ou journal figé depuis 10 min
// (même règle que la liste des tâches).
function termineDe(meta: Objet | null, mtime: number | null, maintenant: number): boolean {
  if (mtime === null) return false;
  const age = maintenant - mtime;
  return (meta?.['finished'] === true && age > DELAI_FIN_MS) || age > DELAI_SORTIE_FIGEE_MS;
}

function evenementsDe(brut: string, agent: string, journal: Logger): EntreeFil[] {
  return brut.split('\n').flatMap((ligne) => {
    const lue = lireLigne(ligne, journal);
    return lue === null ? [] : entreesDe(lue, agent);
  });
}

function entreesDe(lue: Objet, agent: string): EntreeFil[] {
  const ts = texte(lue['timestamp']) ?? '';
  const consigne = messageDe(lue);
  const evenements = consigne !== null ? [{ type: 'message' as const, texte: consigne }] : traduire(lue, agent);
  return evenements.filter((evt) => evt.type !== 'flux').map((evt) => ({ ts, evt: sansAgent(evt) }));
}

// La consigne et les relances SendMessage : une ligne utilisateur qui porte du texte, pas un résultat d'outil.
function messageDe(lue: Objet): string | null {
  if (lue['type'] !== 'user' || lue['isMeta'] === true) return null;
  const message = lue['message'];
  if (!estObjet(message)) return null;
  const contenu = message['content'];
  if (typeof contenu === 'string') return contenu.trim() === '' ? null : contenu;
  const liste = blocs(contenu);
  if (liste.some((bloc) => bloc['type'] === 'tool_result')) return null;
  const brut = liste
    .filter((bloc) => bloc['type'] === 'text')
    .map((bloc) => texte(bloc['text']) ?? '')
    .join('\n');
  return brut.trim() === '' ? null : brut;
}

function sansAgent(evt: Evenement): Evenement {
  if (!('agent' in evt)) return evt;
  const { agent: _agent, ...reste } = evt;
  return reste;
}

// Les MAX_EVENEMENTS derniers ; la consigne (premier message) reste toujours en tête.
function gardees(entrees: EntreeFil[]): EntreeFil[] {
  if (entrees.length <= MAX_EVENEMENTS) return entrees;
  const recentes = entrees.slice(-MAX_EVENEMENTS);
  const consigne = entrees.find((e) => e.evt.type === 'message');
  if (consigne === undefined || recentes.includes(consigne)) return recentes;
  return [consigne, ...recentes.slice(1)];
}

// Fin du tour du sous-agent : durée lue sur tout le transcript, horodatée à sa dernière ligne.
function tourFini(entrees: EntreeFil[]): EntreeFil {
  const horodates = entrees.map((e) => e.ts).filter((t) => t !== '');
  const dernier = horodates[horodates.length - 1] ?? '';
  const duree = Date.parse(dernier) - Date.parse(horodates[0] ?? '');
  return {
    ts: dernier,
    evt: { type: 'tour_fini', dureeMs: Number.isNaN(duree) ? 0 : Math.max(0, duree), contexte: 0 },
  };
}
