// Responsabilité : ce que la machine dit d'elle-même pour l'entretien — interface réseau de la route par défaut (MAC,
// diffusion pour le réveil) et échange (swap). Lecture seule de /proc ; l'analyse est pure et testée.
import { readFileSync } from 'node:fs';
import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os';
import type { Logger } from 'pino';
import { type EchangePoste, IPV4, type ReseauPoste } from '../../commun/entretien.ts';

const MAC_NULLE = '00:00:00:00:00:00';

const versEntier = (ip: string): number => ip.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0);
const versIp = (n: number): string => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

/** L'adresse de diffusion d'un réseau IPv4 (adresse et masque) ; null si l'une des deux n'est pas une IPv4. */
export function diffusionDe(adresse: string, masque: string): string | null {
  if (!IPV4.test(adresse) || !IPV4.test(masque)) return null;
  const m = versEntier(masque);
  return versIp(((versEntier(adresse) & m) | (~m >>> 0)) >>> 0);
}

const RTF_GATEWAY = 0x2;

/** Le nom de l'interface de la route par défaut, dans `/proc/net/route` (destination, masque nuls ; passerelle). */
export function interfaceParDefaut(route: string): string | null {
  for (const ligne of route.split('\n').slice(1)) {
    const c = ligne.trim().split(/\s+/);
    const passerelle = (Number.parseInt(c[3] ?? '0', 16) & RTF_GATEWAY) !== 0;
    if (c[1] === '00000000' && c[7] === '00000000' && passerelle && c[0]) return c[0];
  }
  return null;
}

/** MAC et diffusion de l'interface par défaut (IPv4, non boucle) ; null si la machine n'a pas de route ni de MAC. */
export function reseauDe(route: string, interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): ReseauPoste | null {
  const nom = interfaceParDefaut(route);
  if (!nom) return null;
  const v4 = (interfaces[nom] ?? []).find((i) => i.family === 'IPv4' && !i.internal);
  if (!v4 || v4.mac === MAC_NULLE) return null;
  const diffusion = diffusionDe(v4.address, v4.netmask);
  return diffusion ? { mac: v4.mac, diffusion } : null;
}

/** Swap utilisé et total, depuis `/proc/meminfo` ; null si le champ manque (hors Linux). */
export function echangeDe(meminfo: string): EchangePoste | null {
  const kb = (cle: string): number | null => {
    const m = new RegExp(`^${cle}:\\s+(\\d+)\\s+kB`, 'm').exec(meminfo);
    return m?.[1] ? Number(m[1]) * 1024 : null;
  };
  const total = kb('SwapTotal');
  const libre = kb('SwapFree');
  return total === null || libre === null ? null : { utilise: total - libre, total };
}

// Hors Linux (pas de /proc) : rien à relever, sans bruit. Une autre erreur est journalisée.
function lireProc(chemin: string, journal: Logger): string | null {
  try {
    return readFileSync(chemin, 'utf8');
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT') journal.debug({ chemin, err: erreur }, '/proc illisible');
    return null;
  }
}

export function lireReseau(journal: Logger): ReseauPoste | null {
  const route = lireProc('/proc/net/route', journal);
  return route === null ? null : reseauDe(route, networkInterfaces());
}

export function lireEchange(journal: Logger): EchangePoste | null {
  const meminfo = lireProc('/proc/meminfo', journal);
  return meminfo === null ? null : echangeDe(meminfo);
}
