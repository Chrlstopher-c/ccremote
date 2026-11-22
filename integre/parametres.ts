// Responsabilité : lire les variables LANTERNE_MOTEUR_* posées par l'appli Lanterne (pur, sans effet de bord).
import { homedir } from 'node:os';
import { join } from 'node:path';
import { lireRelaisDistant, type RelaisDistant } from '../poste/relais-distant.ts';

export interface ParametresLancement {
  readonly donnees: string;
  readonly portWeb: number;
  readonly portPostes: number;
  readonly jeton: string;
  readonly codePoste: string | undefined;
  readonly socketTmux: string;
  /** Relais distant (poste seul) : `null` = le moteur lance son relais local. */
  readonly relaisDistant: RelaisDistant | null;
  /** Nœud en service (sans appli) : l'entrée standard n'est pas un lien de vie, le moteur ne s'arrête pas sur sa fermeture. */
  readonly autonome: boolean;
}

export class ErreurParametres extends Error {}

const SOCKET_TMUX_PAR_DEFAUT = 'lanterne';

function port(env: Env, nom: string): number {
  const valeur = env[nom];
  const n = Number(valeur);
  if (!valeur || !Number.isInteger(n) || n < 1 || n > 65535) throw new ErreurParametres(`${nom} absent ou invalide`);
  return n;
}

function requis(env: Env, nom: string): string {
  const valeur = env[nom];
  if (!valeur) throw new ErreurParametres(`${nom} absent`);
  return valeur;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Dossier de données par défaut : $XDG_DATA_HOME/lanterne/moteur, sinon ~/.local/share/lanterne/moteur. */
export function dossierDonneesDefaut(env: Env, maison: string = homedir()): string {
  const base = env['XDG_DATA_HOME'] || join(maison, '.local/share');
  return join(base, 'lanterne/moteur');
}

function relaisDistantOuErreur(env: Env): RelaisDistant | null {
  try {
    return lireRelaisDistant(env);
  } catch (erreur) {
    throw new ErreurParametres(erreur instanceof Error ? erreur.message : String(erreur));
  }
}

export function lireParametres(env: Env, maison: string = homedir()): ParametresLancement {
  return {
    donnees: env['LANTERNE_MOTEUR_DONNEES'] || dossierDonneesDefaut(env, maison),
    portWeb: port(env, 'LANTERNE_MOTEUR_PORT_WEB'),
    portPostes: port(env, 'LANTERNE_MOTEUR_PORT_POSTES'),
    jeton: requis(env, 'LANTERNE_MOTEUR_JETON'),
    codePoste: env['LANTERNE_MOTEUR_CODE_POSTE'] || undefined,
    socketTmux: env['LANTERNE_MOTEUR_TMUX_SOCKET'] || SOCKET_TMUX_PAR_DEFAUT,
    relaisDistant: relaisDistantOuErreur(env),
    autonome: env['LANTERNE_MOTEUR_AUTONOME'] === '1',
  };
}
