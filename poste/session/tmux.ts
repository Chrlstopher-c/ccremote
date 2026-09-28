// Responsabilité : parler au serveur tmux dédié aux Claude (`tmux -L claude`), le même que relais et Atrium :
// une session lancée du bureau, d'Atrium ou de ccremote est la même, attachable de partout.
import { join } from 'node:path';

export const SOCKET = 'claude';
export const PREFIXE = 'claude-';
const CONFIG = join(import.meta.dir, 'tmux.conf');
const FORMAT = ['session_name', 'session_created', 'session_attached', 'pane_current_path', 'pane_title', 'pane_pid']
  .map((c) => `#{${c}}`)
  .join('\t');

export interface Resultat {
  readonly code: number;
  readonly sortie: string;
  readonly erreur: string;
}

export interface PaneTmux {
  readonly nom: string;
  readonly creeLe: number;
  readonly attachee: boolean;
  readonly dossier: string;
  readonly titre: string;
  readonly pid: number;
}

// -u : UTF-8 forcé (un service n'a pas forcément de LANG) ; -f ne compte qu'au démarrage du serveur tmux.
export async function tmux(args: readonly string[], entree?: string): Promise<Resultat> {
  const p = Bun.spawn(['tmux', '-L', SOCKET, '-f', CONFIG, '-u', ...args], {
    stdin: entree === undefined ? 'ignore' : new TextEncoder().encode(entree),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, LANG: process.env['LANG'] ?? 'C.UTF-8' },
  });
  const [code, sortie, erreur] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code, sortie: sortie.trimEnd(), erreur: erreur.trim() };
}

export async function lister(): Promise<PaneTmux[]> {
  const r = await tmux(['list-panes', '-a', '-F', FORMAT]);
  if (r.code !== 0) return []; // pas de serveur tmux : aucune session
  const vus = new Set<string>();
  return r.sortie
    .split('\n')
    .map((l) => l.split('\t'))
    .filter(([nom]) => nom?.startsWith(PREFIXE) && !vus.has(nom) && vus.add(nom))
    .map(([nom = '', cree = '0', attachee = '0', dossier = '', titre = '', pid = '0']) => ({
      nom,
      creeLe: Number(cree),
      attachee: attachee !== '0',
      dossier,
      titre: nettoyerTitre(titre, dossier),
      pid: Number(pid),
    }));
}

// Claude préfixe son titre d'une animation (« ✳ », « ◐ »…) : on ne garde que le nom.
export function nettoyerTitre(titre: string, dossier: string): string {
  const nom = titre.replace(/^[^\p{L}\p{N}]+\s*/u, '').trim();
  return nom && !/^[\w-]+(\.local)?$/.test(nom) ? nom : dossier.split('/').at(-1) || dossier;
}

// `nom` : un nom de projet ou un chemin (seul son dernier segment compte).
export async function nomLibre(nom: string): Promise<string> {
  const base = `${PREFIXE}${(nom.split('/').at(-1) || 'racine').replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const pris = new Set((await lister()).map((p) => p.nom));
  let libre = base;
  for (let n = 2; pris.has(libre); n++) libre = `${base}-${n}`;
  return libre;
}

export function creer(
  nom: string,
  dossier: string,
  commande: readonly string[],
  env: Record<string, string>,
): Promise<Resultat> {
  const variables = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  return tmux(['new-session', '-d', '-s', nom, '-c', dossier, ...variables, '--', ...commande]);
}

// Collage « entre crochets » : un texte multiligne arrive d'un bloc, puis Entrée l'envoie (ou le met en file si Claude
// travaille).
export async function envoyerTexte(nom: string, texte: string): Promise<Resultat> {
  const tampon = `ccremote-${nom}`;
  const charge = await tmux(['load-buffer', '-b', tampon, '-'], texte);
  if (charge.code !== 0) return charge;
  const colle = await tmux(['paste-buffer', '-p', '-d', '-b', tampon, '-t', `=${nom}:`]);
  if (colle.code !== 0) return colle;
  await Bun.sleep(150);
  return tmux(['send-keys', '-t', `=${nom}:`, 'Enter']);
}

export function touche(nom: string, cle: string): Promise<Resultat> {
  return tmux(['send-keys', '-t', `=${nom}:`, cle]);
}

export function tuer(nom: string): Promise<Resultat> {
  return tmux(['kill-session', '-t', `=${nom}`]);
}
