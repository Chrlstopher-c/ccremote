// Responsabilité : mesurer l'état d'une machine de nœud — CPU, charge, mémoire, GPU (nvidia-smi s'il est là), réseau
// (MAC, diffusion), pause, sondes de voix et dictée, comptes. Lecture seule : rien ici ne change la machine.
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import type { Logger } from 'pino';
import type { ReseauPoste } from '../../commun/entretien.ts';
import type { EtatNoeud } from '../../commun/federation.ts';
import { lireReseau } from '../../poste/entretien/systeme.ts';
import type { EtatFonctionNoeud, FonctionsNoeud } from './etat-federation.ts';

type Gpu = NonNullable<EtatNoeud['gpu']>[number];

export const COMMANDE_NVIDIA_SMI: readonly string[] = [
  'nvidia-smi',
  '--query-gpu=name,utilization.gpu,memory.used,memory.total',
  '--format=csv,noheader,nounits',
];
/** Délai accordé à nvidia-smi : au-delà, il est tué et le GPU est tenu pour absent. */
export const DELAI_GPU_MS = 2000;
const NOMBRE_MAX_GPU = 8;
const NOMBRE_MAX_COMPTES = 20;
const LONGUEUR_MAX_NOM_GPU = 120;
const ETAT_ABSENT: EtatFonctionNoeud = 'absente';

export interface DependancesEtatNoeud {
  readonly journal: Logger;
  readonly pause: () => boolean;
  readonly comptes: () => string[];
  readonly compteChoisi?: () => string | null;
  readonly fonctions?: FonctionsNoeud;
  readonly nvidiaSmi?: readonly string[];
  /** Réseau local ; absent, relevé sur la machine (`lireReseau`). */
  readonly reseau?: () => ReseauPoste | null;
}

interface Echantillon {
  readonly actif: number;
  readonly total: number;
}

function echantillonCpu(): Echantillon {
  let actif = 0;
  let total = 0;
  for (const c of cpus()) {
    const t = c.times;
    const somme = t.user + t.nice + t.sys + t.idle + t.irq;
    total += somme;
    actif += somme - t.idle;
  }
  return { actif, total };
}

// Le CPU se lit entre deux relevés : ce module garde le dernier (le premier relevé couvre depuis le démarrage).
let precedent = echantillonCpu();

function cpuDepuisDernier(): number | null {
  const courant = echantillonCpu();
  const dTotal = courant.total - precedent.total;
  const dActif = courant.actif - precedent.actif;
  precedent = courant;
  if (dTotal <= 0) return null;
  return Math.round((dActif / dTotal) * 1000) / 10;
}

function nombre(texte: string | undefined): number | null {
  if (texte === undefined || texte === '') return null;
  const n = Number(texte);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function pourcentage(texte: string | undefined): number | null {
  const n = nombre(texte);
  return n !== null && n <= 100 ? n : null;
}

/** Les GPU d'une sortie de nvidia-smi (« nom, utilisation, mémoire utilisée, mémoire totale ») ; « [N/A] » : null. */
export function analyserGpu(sortie: string): Gpu[] {
  return sortie
    .split('\n')
    .map((ligne) => ligne.split(',').map((c) => c.trim()))
    .filter((c) => c.length >= 4)
    .slice(0, NOMBRE_MAX_GPU)
    .map((c) => ({
      nom: c.slice(0, -3).join(', ').slice(0, LONGUEUR_MAX_NOM_GPU),
      utilisation: pourcentage(c.at(-3)),
      memoireUtilisee: nombre(c.at(-2)),
      memoireTotale: nombre(c.at(-1)),
    }));
}

/** Les GPU de la machine ; null si la commande est absente, échoue ou dépasse son délai. */
export async function lireGpu(argv: readonly string[], journal: Logger): Promise<Gpu[] | null> {
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  try {
    const processus = Bun.spawn([...argv], { stdout: 'pipe', stderr: 'ignore' });
    minuterie = setTimeout(() => processus.kill(), DELAI_GPU_MS);
    const [sortie, code] = await Promise.all([new Response(processus.stdout).text(), processus.exited]);
    return code === 0 ? analyserGpu(sortie) : null;
  } catch (erreur) {
    journal.debug({ err: erreur }, 'nvidia-smi indisponible : pas de GPU relevé');
    return null;
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}

async function lireFonction(
  nom: string,
  sonde: FonctionsNoeud['voix'],
  journal: Logger,
): Promise<EtatFonctionNoeud> {
  if (!sonde) return ETAT_ABSENT;
  try {
    return await sonde();
  } catch (erreur) {
    journal.warn({ err: erreur, fonction: nom }, 'sonde de fonction en échec : tenue pour absente');
    return ETAT_ABSENT;
  }
}

function reseauDeNoeud(d: DependancesEtatNoeud): ReseauPoste | null {
  try {
    return d.reseau ? d.reseau() : lireReseau(d.journal);
  } catch (erreur) {
    d.journal.warn({ err: erreur }, 'réseau de la machine illisible');
    return null;
  }
}

/** Une commande d'arrêt ne part que sous Linux et macOS (la seule extinction prévue par le nœud). */
export function peutArreterCetteMachine(): boolean {
  return process.platform === 'linux' || process.platform === 'darwin';
}

/** L'état de cette machine, mesuré à la demande. */
export async function mesurerEtatNoeud(d: DependancesEtatNoeud): Promise<EtatNoeud> {
  const reseau = reseauDeNoeud(d);
  const gpu = await lireGpu(d.nvidiaSmi ?? COMMANDE_NVIDIA_SMI, d.journal);
  const [voix, dictee] = await Promise.all([
    lireFonction('voix', d.fonctions?.voix, d.journal),
    lireFonction('dictee', d.fonctions?.dictee, d.journal),
  ]);
  const totale = totalmem();
  return {
    le: new Date().toISOString(),
    cpu: cpuDepuisDernier(),
    charge: loadavg()[0] ?? null,
    memoire: { utilisee: totale - freemem(), totale },
    gpu,
    reseau,
    pause: d.pause(),
    fonctions: { voix, dictee },
    comptes: d.comptes().slice(0, NOMBRE_MAX_COMPTES),
    compte: d.compteChoisi?.() ?? null,
    peutArreter: peutArreterCetteMachine(),
    peutRedemarrer: process.env['LANTERNE_MOTEUR_AUTONOME'] === '1',
    reveilPossible: reseau !== null,
  };
}
