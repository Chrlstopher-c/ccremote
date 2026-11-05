// Responsabilité : ce qu'il faut donner à Claude pour se brancher sur Quart (URL du connecteur, commande Claude Code)
// et la façon de présenter les accès (libellés, regroupement). Pur, testé.
import type { GenreAcces, VueAcces } from '../../../commun/api-clients.ts';

export const LIBELLES_GENRE: Record<GenreAcces, string> = {
  appareil: 'Appareils connectés',
  'claude-ai': 'Claude.ai (connecteur)',
  'claude-code': 'Claude Code (MCP)',
};

export const DUREES = [
  { jours: 30, libelle: '30 jours' },
  { jours: 90, libelle: '90 jours' },
  { jours: 365, libelle: '1 an' },
] as const;

export function urlConnecteur(base: string, jeton: string): string {
  return `${base.replace(/\/+$/, '')}/mcp/${jeton}`;
}

export function commandeClaudeCode(base: string, jeton: string): string {
  const url = `${base.replace(/\/+$/, '')}/mcp`;
  return `claude mcp add --transport http --scope user quart ${url} --header "Authorization: Bearer ${jeton}"`;
}

// Un navigateur se présente par son user-agent : on n'en garde que « Firefox · Linux ».
export function nomLisible(nom: string): string {
  if (!nom.startsWith('Mozilla/')) return nom;
  const systeme = /iPhone|iPad/.test(nom) ? 'iPhone' : /Android/.test(nom) ? 'Android'
    : /Mac OS X/.test(nom) ? 'Mac' : /Windows/.test(nom) ? 'Windows' : /Linux/.test(nom) ? 'Linux' : 'appareil';
  const nav = /Firefox\//.test(nom) ? 'Firefox' : /Edg\//.test(nom) ? 'Edge' : /Chrome\//.test(nom) ? 'Chrome'
    : /Safari\//.test(nom) ? 'Safari' : 'Navigateur';
  return `${nav} · ${systeme}`;
}

export function regrouperAcces(acces: readonly VueAcces[]): { genre: GenreAcces; acces: VueAcces[] }[] {
  const ordre: GenreAcces[] = ['claude-ai', 'claude-code', 'appareil'];
  return ordre
    .map((genre) => ({ genre, acces: acces.filter((a) => a.genre === genre) }))
    .filter((g) => g.acces.length > 0);
}

export function nomPropose(genre: Exclude<GenreAcces, 'appareil'>, existants: readonly VueAcces[]): string {
  const racine = genre === 'claude-ai' ? 'claude.ai' : 'Claude Code';
  const pris = new Set(existants.map((a) => a.nom));
  if (!pris.has(racine)) return racine;
  let i = 2;
  while (pris.has(`${racine} ${i}`)) i += 1;
  return `${racine} ${i}`;
}
