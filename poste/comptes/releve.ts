// Responsabilité : relever un compte Claude Code de la machine. Le relevé périodique ne lit que l'identité (`claude auth
// status`, local). L'usage (API OAuth) n'est lu que sur commande du relais, qui en décide la cadence : un seul poste
// relève un compte réel. Lecture seule : le jeton n'est jamais renouvelé ici.
import { renouvelerJeton } from './renouveler-jeton.ts';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { DonneesReleve, EtatCompte } from '../../commun/comptes.ts';
import { binaireClaude } from '../session/lanceur.ts';
import { AGENT_CLI } from './lecture-compte.ts';
import { lireUsage } from './usage.ts';

const URL_USAGE = 'https://api.anthropic.com/api/oauth/usage';
const URL_CEDAR = `${URL_USAGE}?cedar_ember=1&skip_spend=1`;
const DELAI_MS = 20_000;

type Objet = Record<string, unknown>;

export interface Identite {
  readonly connecte: boolean;
  readonly email: string | null;
  readonly organisation: string | null;
  readonly abonnement: string | null;
}

const texte = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Clé d'un compte réel : son courriel. Sans identité (jeton longue durée seul) : null, donc aucun relevé. */
export function cleDeCompte(qui: Pick<Identite, 'connecte' | 'email'>): string | null {
  return qui.connecte && qui.email ? `courriel:${qui.email.toLowerCase()}` : null;
}

export function environnementCompte(configDir: string | null): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'CLAUDE_CONFIG_DIR') env[k] = v;
  return configDir ? { ...env, CLAUDE_CONFIG_DIR: configDir } : env;
}

export async function identite(configDir: string | null): Promise<Identite> {
  const p = Bun.spawn([binaireClaude(), 'auth', 'status', '--json'], {
    env: environnementCompte(configDir),
    stdout: 'pipe',
    stderr: 'ignore',
    stdin: 'ignore',
  });
  const minuterie = setTimeout(() => p.kill(), DELAI_MS);
  const sortie = await new Response(p.stdout).text();
  clearTimeout(minuterie);
  await p.exited;
  const j = JSON.parse(sortie || '{}') as Objet;
  return {
    connecte: j['loggedIn'] === true,
    email: texte(j['email']),
    organisation: texte(j['orgName']),
    abonnement: texte(j['subscriptionType']),
  };
}

function jeton(configDir: string | null): string | null {
  const fichier = join(configDir ?? join(homedir(), '.claude'), '.credentials.json');
  if (!existsSync(fichier)) return null;
  const oauth = (JSON.parse(readFileSync(fichier, 'utf8')) as Objet)['claudeAiOauth'] as Objet | undefined;
  const valeur = texte(oauth?.['accessToken']);
  const expireLe = Number(oauth?.['expiresAt'] ?? 0);
  if (!valeur || (expireLe > 0 && expireLe < Date.now())) return null;
  return valeur;
}

/** Retry-After en millisecondes : secondes, ou date HTTP. Absent ou illisible : null. */
export function retryApresMs(valeur: string | null, maintenant: number = Date.now()): number | null {
  if (valeur === null) return null;
  const secondes = Number(valeur);
  if (Number.isFinite(secondes) && secondes >= 0) return secondes * 1000;
  const date = Date.parse(valeur);
  return Number.isNaN(date) ? null : Math.max(0, date - maintenant);
}

/** Un appel de l'endpoint d'usage : corps lu si 2xx, sinon statut et Retry-After. Jamais de jeton dans un message. */
interface LectureEndpoint {
  readonly corps: unknown | null;
  readonly statut: number | null;
  readonly retryApresMs: number | null;
  readonly erreur: string | null;
}

async function lireEndpoint(jetonValeur: string, url: string): Promise<LectureEndpoint> {
  try {
    const r = await fetch(url, {
      headers: {
        authorization: `Bearer ${jetonValeur}`,
        'user-agent': AGENT_CLI,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!r.ok) {
      return {
        corps: null,
        statut: r.status,
        retryApresMs: retryApresMs(r.headers.get('retry-after')),
        erreur: `HTTP ${r.status}`,
      };
    }
    return { corps: await r.json(), statut: null, retryApresMs: null, erreur: null };
  } catch (erreur) {
    return { corps: null, statut: null, retryApresMs: null, erreur: erreur instanceof Error ? erreur.name : 'erreur' };
  }
}

/** Relevé d'usage commandé par le relais : les deux endpoints, un appel chacun. Sans jeton : erreur sans appel. */
export async function releverUsage(
  configDir: string | null,
  renouveler: (configDir: string | null) => Promise<boolean> = renouvelerJeton,
): Promise<DonneesReleve> {
  // Jeton expiré (Claude Code n'a pas tourné depuis quelques heures sur ce compte) : renouvelé puis relu, au plus une
  // fois par demi-heure (renouveler-jeton.ts). Le portable affichait 0 % faute de jeton, 25/11.
  const valeur = jeton(configDir) ?? ((await renouveler(configDir)) ? jeton(configDir) : null);
  if (valeur === null) {
    return {
      fenetres: null,
      usage: null,
      cedar: null,
      statut: null,
      retryApresMs: null,
      erreur: 'aucun jeton OAuth valide',
    };
  }
  const usage = await lireEndpoint(valeur, URL_USAGE);
  const cedar = await lireEndpoint(valeur, URL_CEDAR);
  const pires = [usage, cedar].find((l) => l.statut === 429) ?? [usage, cedar].find((l) => l.statut !== null) ?? null;
  const erreurs = [usage, cedar].flatMap((l) => (l.erreur ? [`usage ${l.erreur}`] : []));
  return {
    fenetres: usage.corps === null ? null : lireUsage(usage.corps),
    usage: usage.corps,
    cedar: cedar.corps,
    statut: pires?.statut ?? null,
    retryApresMs: pires?.retryApresMs ?? null,
    erreur: erreurs.length > 0 ? erreurs.join(' ; ') : null,
  };
}

/** Relevé périodique : identité seule (local), jamais d'appel réseau à l'usage. */
export async function releverCompte(id: string, configDir: string | null, journal: Logger): Promise<EtatCompte> {
  const base = {
    id,
    defaut: configDir === null,
    releveLe: new Date().toISOString(),
    connexion: null,
    distant: false,
    session: null,
    semaine: null,
    autres: [],
    usageLe: null,
    prochainReleve: null,
  };
  try {
    const qui = await identite(configDir);
    const cle = cleDeCompte(qui);
    const probleme = !qui.connecte
      ? 'compte déconnecté'
      : cle === null
        ? 'identité inconnue (jeton sans courriel) : pas de relevé d’utilisation'
        : null;
    return { ...base, ...qui, cle, probleme };
  } catch (erreur) {
    journal.warn({ compte: id, err: erreur }, 'relevé du compte en échec');
    const vide = { connecte: false, email: null, organisation: null, abonnement: null };
    return { ...base, ...vide, cle: null, probleme: `relevé impossible : ${String(erreur)}` };
  }
}
