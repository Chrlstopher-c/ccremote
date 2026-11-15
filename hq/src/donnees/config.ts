// Responsabilité : la configuration de la source du monde — variables Vite (VITE_SOURCE, VITE_RELAIS_URL) et jeton
// stocké dans le navigateur. Aucun secret en dur : le jeton n'entre que par le stockage local, jamais par le code.
import { journaliser } from './journal';
import type { NomSource } from './source-monde';

export const CLE_JETON = 'agent-hq.jeton';

export interface EnvSource {
  readonly VITE_SOURCE?: string;
  readonly VITE_RELAIS_URL?: string;
}

export interface StockageJeton {
  getItem(cle: string): string | null;
}

export interface ConfigMonde {
  readonly source: NomSource;
  readonly base: string;
  readonly jeton: string;
}

const DEMO: ConfigMonde = { source: 'demo', base: '', jeton: '' };

// Le stockage local peut être refusé (navigation privée, iframe sandboxée) : null au lieu d'une exception.
export function stockageNavigateur(): StockageJeton | null {
  try {
    return globalThis.localStorage ?? null;
  } catch (erreur) {
    journaliser('warn', 'stockage local inaccessible', { erreur: String(erreur) });
    return null;
  }
}

export function lireConfig(env: EnvSource, stockage: StockageJeton | null): ConfigMonde {
  const demande = env.VITE_SOURCE ?? 'demo';
  if (demande !== 'demo' && demande !== 'relais') {
    journaliser('warn', 'VITE_SOURCE inconnue, la démo est utilisée', { valeur: demande });
    return DEMO;
  }
  if (demande === 'demo') return DEMO;
  const base = (env.VITE_RELAIS_URL ?? '').trim();
  const jeton = lireJeton(stockage);
  if (base === '' || jeton === '') {
    journaliser('warn', 'source relais incomplète, la démo est utilisée', { url: base !== '', jeton: jeton !== '' });
    return DEMO;
  }
  return { source: 'relais', base, jeton };
}

function lireJeton(stockage: StockageJeton | null): string {
  if (!stockage) return '';
  try {
    return stockage.getItem(CLE_JETON) ?? '';
  } catch (erreur) {
    journaliser('warn', 'jeton illisible dans le stockage local', { erreur: String(erreur) });
    return '';
  }
}
