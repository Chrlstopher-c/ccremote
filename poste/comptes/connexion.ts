// Responsabilité : connecter un compte Claude Code sur cette machine par OAuth, en deux temps — `claude auth login`
// lancé dans un tmux à part (hors des sessions suivies), son URL rendue à Quart qui l'ouvre dans le navigateur de
// Chris, puis le code collé par Chris tapé dans ce même tmux. Aucun navigateur n'est ouvert sur la machine elle-même.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { binaireClaude } from '../session/lanceur.ts';
import * as tmux from '../session/tmux.ts';
import { identite } from './releve.ts';

const PREFIXE = 'quart-connexion-';
const URL_OAUTH = /https:\/\/\S+\/oauth\/authorize\?\S+/;
const ATTENTE_URL_MS = 20_000;
const ATTENTE_VALIDATION_MS = 30_000;
const PAS_MS = 500;

const nomTmux = (compte: string): string => `${PREFIXE}${compte}`;

async function attendre<T>(delaiMs: number, essai: () => Promise<T | null>): Promise<T | null> {
  for (let fin = Date.now() + delaiMs; Date.now() < fin; await Bun.sleep(PAS_MS)) {
    const r = await essai();
    if (r !== null) return r;
  }
  return null;
}

/** Lance la connexion et rend l'URL d'autorisation à ouvrir, ou une erreur. */
export async function demarrerConnexion(
  compte: string,
  configDir: string,
): Promise<{ url: string } | { erreur: string }> {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  await tmux.tuer(nomTmux(compte)); // une connexion précédente abandonnée
  const commande = ['env', '-u', 'DISPLAY', '-u', 'WAYLAND_DISPLAY', 'BROWSER=true', `CLAUDE_CONFIG_DIR=${configDir}`];
  const r = await tmux.creer(nomTmux(compte), homedir(), [...commande, binaireClaude(), 'auth', 'login'], {});
  if (r.code !== 0) return { erreur: `tmux refuse la connexion : ${r.erreur}` };
  const lireUrl = async (): Promise<string | null> =>
    (await tmux.capturer(nomTmux(compte)))?.match(URL_OAUTH)?.[0] ?? null;
  const url = await attendre(ATTENTE_URL_MS, lireUrl);
  if (url) return { url };
  await tmux.tuer(nomTmux(compte));
  return { erreur: 'claude auth login n’a pas donné d’URL de connexion' };
}

/** Tape le code rendu par la page de connexion, puis attend que le compte se déclare connecté. */
export async function validerConnexion(compte: string, configDir: string, code: string): Promise<string | null> {
  const pane = nomTmux(compte);
  if ((await tmux.capturer(pane)) === null) return 'aucune connexion en cours pour ce compte : recommence';
  const tape = await tmux.taper(pane, code.trim());
  if (tape.code !== 0) return `tmux refuse le code : ${tape.erreur}`;
  await tmux.touche(pane, 'Enter');
  // Le CLI signale tout de suite un code refusé ; sinon, on attend qu'il déclare le compte connecté.
  const issue = await attendre(ATTENTE_VALIDATION_MS, async () => {
    if (/Invalid code|error/i.test((await tmux.capturer(pane)) ?? '')) return 'refuse' as const;
    return (await identite(configDir)).connecte ? ('ok' as const) : null;
  });
  const ecran = (await tmux.capturer(pane)) ?? '';
  if (issue === 'ok') {
    await tmux.tuer(pane);
    return null;
  }
  if (issue === 'refuse') {
    await tmux.tuer(pane);
    return 'code refusé par Claude : relance la connexion et copie le code en entier';
  }
  const derniere = ecran.split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
  return `connexion non confirmée${derniere ? ` : ${derniere.slice(0, 200)}` : ''}`;
}

export async function abandonnerConnexion(compte: string): Promise<void> {
  await tmux.tuer(nomTmux(compte));
}
