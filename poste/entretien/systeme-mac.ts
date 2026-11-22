// Responsabilité : ce que macOS dit de la machine pour l'entretien — interface de la route par défaut (route)
// et swap (sysctl vm.swapusage). Analyseurs purs testés ; les appels système sont dans `executerMac`.
import type { EchangePoste } from '../../commun/entretien.ts';

const MULTIPLICATEUR: Readonly<Record<string, number>> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 };

/** Le nom de l'interface de `route -n get default` (ligne « interface: en0 »). */
export function interfaceParDefautMac(sortie: string): string | null {
  return /^\s*interface:\s*(\S+)/m.exec(sortie)?.[1] ?? null;
}

/** Swap utilisé et total, depuis `sysctl -n vm.swapusage` (« total = 2048.00M  used = 1024.50M … »). */
export function echangeDeMac(sortie: string): EchangePoste | null {
  const total = /total = ([\d.]+)([KMG])/.exec(sortie);
  const utilise = /used = ([\d.]+)([KMG])/.exec(sortie);
  if (!total || !utilise) return null;
  const octets = (m: RegExpExecArray): number => Number(m[1]) * (MULTIPLICATEUR[m[2] ?? ''] ?? 1);
  return { utilise: octets(utilise), total: octets(total) };
}

/** Sortie standard d'une commande système ; null si elle échoue. */
export function executerMac(commande: readonly string[]): string | null {
  const r = Bun.spawnSync([...commande], { stdout: 'pipe', stderr: 'pipe' });
  return r.exitCode === 0 ? r.stdout.toString() : null;
}
