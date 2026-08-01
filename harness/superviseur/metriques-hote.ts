/**
 * Responsabilité : ce qu'une machine de travail sait dire d'ELLE-MÊME — charge,
 * mémoire, disque, réseau, GPU. Relevé sur place, transporté par le lien du
 * harness (`OperationControle` `metriques_hote`).
 *
 * `☠ POURQUOI PAS LE CHEMIN EXISTANT.` L'interface lisait déjà des métriques,
 * par `pi-web/pc_client.py` → `server/server.py` : un WebSocket LAN vers
 * `pc.exemple:8765`, propre au PC de Chris. Ce chemin ne peut pas servir une
 * seconde machine — le VPS n'est pas sur le LAN, n'a pas ce serveur, et l'y
 * déployer exigerait d'exposer un canal de contrôle de plus sur Internet. Le
 * lien du harness, lui, est déjà authentifié, déjà multi-machines, et déjà
 * traversé par Cloudflare. Une machine qui se rattache apporte donc ses
 * métriques sans aucune configuration réseau supplémentaire.
 *
 * `☠ UNE SEULE SOURCE.` La page « État du système » lit maintenant CE chemin
 * pour toutes les machines, y compris le PC. Garder les deux ferait diverger
 * deux mesures du même hôte — le dépôt a déjà écrit cette règle pour les jauges
 * de quota (`pcview.js`), elle vaut ici pour la même raison.
 *
 * `☠` Ne lève JAMAIS : une métrique indisponible vaut `null` et se dit à
 * l'écran par un tiret. Un relevé qui échoue ne doit pas faire disparaître la
 * machine de la page — l'absence d'un chiffre et l'absence d'une machine sont
 * deux informations opposées.
 */

import { readFile } from 'node:fs/promises';
import { statfs } from 'node:fs/promises';
import { hostname, totalmem, freemem, uptime } from 'node:os';

export interface MetriquesHote {
  readonly machine: string;
  /** Charge CPU en %, calculée sur l'INTERVALLE depuis le relevé précédent. */
  readonly cpuPct: number | null;
  readonly memUtiliseeMo: number | null;
  readonly memTotaleMo: number | null;
  readonly memPct: number | null;
  readonly disqueUtiliseGo: number | null;
  readonly disqueTotalGo: number | null;
  readonly tempCpuC: number | null;
  readonly uptimeS: number;
  readonly reseauMontantKo: number | null;
  readonly reseauDescendantKo: number | null;
  /** `null` sur une machine sans GPU NVIDIA — le VPS, par exemple. */
  readonly gpu: MetriquesGpu | null;
  readonly releveA: number;
}

export interface MetriquesGpu {
  readonly utilPct: number | null;
  readonly memUtiliseeMo: number | null;
  readonly memTotaleMo: number | null;
  readonly tempC: number | null;
}

const MO = 1024 * 1024;
const GO = 1024 * 1024 * 1024;
/** Racine mesurée pour le disque : celle des projets, la seule qui puisse se remplir. */
const RACINE_DISQUE = '/';

/**
 * `☠` Instantané précédent, gardé au niveau du MODULE et non par appel : un
 * pourcentage CPU est un rapport de deux relevés, il n'existe pas dans un seul.
 * Le premier appel après démarrage rend donc `null`, ce qui est la vérité — pas
 * un zéro, qui se lirait comme « machine au repos ».
 */
let precedent: { cpu: { total: number; oisif: number } | null; reseau: { rx: number; tx: number } | null; a: number } | null =
  null;

async function lireTexte(chemin: string): Promise<string | null> {
  try {
    return await readFile(chemin, 'utf8');
  } catch {
    return null;
  }
}

/** Somme des compteurs `/proc/stat` — cumulés depuis le boot, jamais un taux. */
function lireCpuBrut(procStat: string): { total: number; oisif: number } | null {
  const ligne = procStat.split('\n').find((l) => l.startsWith('cpu '));
  if (ligne === undefined) return null;
  const champs = ligne.trim().split(/\s+/).slice(1).map(Number);
  if (champs.length < 5 || champs.some((n) => !Number.isFinite(n))) return null;
  const total = champs.reduce((s, n) => s + n, 0);
  // `idle` + `iowait` : une machine qui attend son disque n'utilise pas son CPU.
  const oisif = (champs[3] ?? 0) + (champs[4] ?? 0);
  return { total, oisif };
}

/** Octets reçus/émis, toutes interfaces sauf `lo` (le trafic local n'est pas du réseau). */
function lireReseauBrut(procNetDev: string): { rx: number; tx: number } | null {
  let rx = 0;
  let tx = 0;
  let vues = 0;
  for (const ligne of procNetDev.split('\n').slice(2)) {
    const [nom, reste] = ligne.split(':');
    if (nom === undefined || reste === undefined) continue;
    if (nom.trim() === 'lo') continue;
    const champs = reste.trim().split(/\s+/).map(Number);
    if (champs.length < 10) continue;
    rx += champs[0] ?? 0;
    tx += champs[8] ?? 0;
    vues += 1;
  }
  return vues === 0 ? null : { rx, tx };
}

/**
 * `☠ MESURÉ LE 01/08, ET C'EST TOUT L'OBJET DE CETTE FONCTION.` La première
 * version lisait `thermal_zone0` — sur le PC de Chris, c'est `acpitz`, qui
 * rendait **16,8 °C** pendant que le processeur était à **72,75 °C**. Un capteur
 * existant, une valeur plausible, et complètement fausse : le pire cas, parce
 * qu'aucune alarme ne s'allume sur un chiffre qui a l'air normal.
 *
 * On lit donc les capteurs par leur NOM, jamais par leur numéro d'ordre.
 * `k10temp` (AMD), `coretemp` (Intel), `cpu_thermal` (Raspberry Pi) sont les
 * seuls à mesurer réellement le processeur. Rien de connu ⇒ `null` : pas de
 * température vaut mieux qu'une fausse.
 */
const CAPTEURS_CPU: readonly string[] = ['k10temp', 'coretemp', 'cpu_thermal', 'zenpower'];

async function lireTempCpu(): Promise<number | null> {
  for (let i = 0; i < 12; i += 1) {
    const base = `/sys/class/hwmon/hwmon${i}`;
    const nom = (await lireTexte(`${base}/name`))?.trim();
    if (nom === undefined || !CAPTEURS_CPU.includes(nom)) continue;
    const milli = Number((await lireTexte(`${base}/temp1_input`))?.trim());
    // Un capteur peut exister et rendre 0 : c'est un capteur muet, pas un CPU
    // à 0 °C. Au-delà de 150 °C, c'est une unité mal interprétée, pas une panne.
    if (Number.isFinite(milli) && milli > 0 && milli < 150_000) return Math.round(milli / 1000);
  }
  // `☠` Aucun repli sur `thermal_zone*` : c'est exactement ce qui a produit le
  // faux 17 °C. Une machine virtualisée (le VPS) n'a aucun capteur — `null` est
  // alors la seule réponse vraie.
  return null;
}

async function lireDisque(): Promise<{ utiliseGo: number | null; totalGo: number | null }> {
  try {
    const s = await statfs(RACINE_DISQUE);
    const total = Number(s.blocks) * Number(s.bsize);
    // `bavail` (dispo pour l'utilisateur) et non `bfree` : les blocs réservés à
    // root ne sont pas de l'espace utilisable, les compter ferait annoncer de la
    // place qui n'existe pas.
    const libre = Number(s.bavail) * Number(s.bsize);
    return { utiliseGo: Math.round(((total - libre) / GO) * 10) / 10, totalGo: Math.round((total / GO) * 10) / 10 };
  } catch {
    return { utiliseGo: null, totalGo: null };
  }
}

/** `null` si `nvidia-smi` est absent — le cas nominal sur un VPS. */
async function lireGpu(): Promise<MetriquesGpu | null> {
  try {
    const proc = Bun.spawn(
      ['nvidia-smi', '--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits'],
      { stdout: 'pipe', stderr: 'ignore' },
    );
    const sortie = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return null;
    const [util, memU, memT, temp] = (sortie.split('\n')[0] ?? '').split(',').map((v) => Number(v.trim()));
    if (!Number.isFinite(util)) return null;
    return {
      utilPct: util ?? null,
      memUtiliseeMo: Number.isFinite(memU) ? (memU as number) : null,
      memTotaleMo: Number.isFinite(memT) ? (memT as number) : null,
      tempC: Number.isFinite(temp) ? (temp as number) : null,
    };
  } catch {
    return null;
  }
}

/** Taux entre deux relevés cumulés. `null` tant qu'il n'y a pas de précédent. */
function taux(courant: number, ancien: number, secondes: number): number | null {
  if (secondes <= 0) return null;
  const delta = courant - ancien;
  // Compteur reparti à zéro (redémarrage d'interface) : on ne rend pas un
  // nombre négatif ni une pointe absurde, on attend le relevé suivant.
  if (delta < 0) return null;
  return Math.round((delta / 1024 / secondes) * 10) / 10;
}

/** Part de CPU non oisive entre deux relevés cumulés. `null` sans précédent. */
function cpuEntre(
  courant: { total: number; oisif: number } | null,
  ancien: { total: number; oisif: number } | null,
): number | null {
  if (courant === null || ancien === null) return null;
  const dTotal = courant.total - ancien.total;
  if (dTotal <= 0) return null;
  const dOisif = courant.oisif - ancien.oisif;
  return Math.max(0, Math.min(100, Math.round(((dTotal - dOisif) / dTotal) * 100)));
}

export async function releverMetriquesHote(machineId?: string): Promise<MetriquesHote> {
  const maintenant = Date.now();
  const [procStat, procNet, tempCpuC, disque, gpu] = await Promise.all([
    lireTexte('/proc/stat'),
    lireTexte('/proc/net/dev'),
    lireTempCpu(),
    lireDisque(),
    lireGpu(),
  ]);

  const cpuBrut = procStat === null ? null : lireCpuBrut(procStat);
  const reseauBrut = procNet === null ? null : lireReseauBrut(procNet);
  // `☠` L'ancien est capturé AVANT d'écrire le nouveau. L'écraser d'abord ferait
  // comparer un relevé avec lui-même — donc 0 % de CPU en permanence, un chiffre
  // parfaitement stable et parfaitement faux.
  const ancien = precedent;
  const secondes = ancien === null ? 0 : (maintenant - ancien.a) / 1000;
  precedent = { cpu: cpuBrut, reseau: reseauBrut, a: maintenant };

  const memTotale = totalmem();
  const memUtilisee = memTotale - freemem();
  const reseau =
    reseauBrut === null || ancien?.reseau == null
      ? { montantKo: null, descendantKo: null }
      : {
          montantKo: taux(reseauBrut.tx, ancien.reseau.tx, secondes),
          descendantKo: taux(reseauBrut.rx, ancien.reseau.rx, secondes),
        };

  return {
    machine: machineId ?? hostname().toLowerCase(),
    cpuPct: cpuEntre(cpuBrut, ancien?.cpu ?? null),
    memUtiliseeMo: Math.round(memUtilisee / MO),
    memTotaleMo: Math.round(memTotale / MO),
    memPct: memTotale > 0 ? Math.round((memUtilisee / memTotale) * 100) : null,
    disqueUtiliseGo: disque.utiliseGo,
    disqueTotalGo: disque.totalGo,
    tempCpuC,
    uptimeS: Math.round(uptime()),
    reseauMontantKo: reseau.montantKo,
    reseauDescendantKo: reseau.descendantKo,
    gpu,
    releveA: maintenant,
  };
}
