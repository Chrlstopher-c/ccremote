// Responsabilité : relever un compte Claude Code de la machine — identité (`claude auth status`), puis usage (API
// OAuth, avec le jeton que Claude Code tient à jour). Lecture seule : le jeton n'est jamais renouvelé ici, pour ne pas
// entrer en concurrence avec les sessions qui l'utilisent.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { EtatCompte } from '../../commun/comptes.ts';
import { binaireClaude } from '../session/lanceur.ts';
import { lireUsage } from './usage.ts';

const URL_USAGE = 'https://api.anthropic.com/api/oauth/usage';
const DELAI_MS = 20_000;

type Objet = Record<string, unknown>;

interface Identite {
  readonly connecte: boolean;
  readonly email: string | null;
  readonly organisation: string | null;
  readonly abonnement: string | null;
}

const texte = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

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

function jeton(configDir: string | null): { valeur: string; expireLe: number } | null {
  const fichier = join(configDir ?? join(homedir(), '.claude'), '.credentials.json');
  if (!existsSync(fichier)) return null;
  const oauth = (JSON.parse(readFileSync(fichier, 'utf8')) as Objet)['claudeAiOauth'] as Objet | undefined;
  const valeur = texte(oauth?.['accessToken']);
  return valeur ? { valeur, expireLe: Number(oauth?.['expiresAt'] ?? 0) } : null;
}

type Releve = Pick<EtatCompte, 'session' | 'semaine' | 'autres' | 'probleme'>;

async function usage(configDir: string | null): Promise<Releve> {
  const vide = { session: null, semaine: null, autres: [] };
  const j = jeton(configDir);
  if (!j) return { ...vide, probleme: 'aucun jeton OAuth (compte connecté par clé d’API ?)' };
  if (j.expireLe > 0 && j.expireLe < Date.now())
    return { ...vide, probleme: 'jeton expiré : il se renouvelle à la prochaine session ouverte avec ce compte' };
  const r = await fetch(URL_USAGE, {
    headers: { authorization: `Bearer ${j.valeur}`, 'anthropic-beta': 'oauth-2025-04-20' },
    signal: AbortSignal.timeout(DELAI_MS),
  });
  if (!r.ok) return { ...vide, probleme: `usage illisible : HTTP ${r.status}` };
  return { ...lireUsage(await r.json()), probleme: null };
}

export async function releverCompte(id: string, configDir: string | null, journal: Logger): Promise<EtatCompte> {
  const base = { id, defaut: configDir === null, releveLe: new Date().toISOString(), connexion: null };
  try {
    const qui = await identite(configDir);
    if (!qui.connecte)
      return { ...base, ...qui, session: null, semaine: null, autres: [], probleme: 'compte déconnecté' };
    return { ...base, ...qui, ...(await usage(configDir)) };
  } catch (erreur) {
    journal.warn({ compte: id, err: erreur }, 'relevé du compte en échec');
    const vide = { connecte: false, email: null, organisation: null, abonnement: null };
    const probleme = `relevé impossible : ${String(erreur)}`;
    return { ...base, ...vide, session: null, semaine: null, autres: [], probleme };
  }
}
