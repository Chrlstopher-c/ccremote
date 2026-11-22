// Responsabilité : les tunnels SSH inverses du relais intégré — un processus `ssh -N -R` par machine installée, relancé
// avec attente croissante, arrêté à l'arrêt du relais. Rien n'écoute sur le réseau : c'est la machine de l'appli qui
// ouvre la connexion vers chaque machine distante.
import type { Logger } from 'pino';
import type { ConnexionSsh } from './ssh.ts';

export interface CibleTunnel {
  readonly id: string;
  readonly connexion: ConnexionSsh;
  readonly portDistant: number;
}

export interface ProcessusTunnel {
  readonly pid: number;
  readonly sortie: Promise<number>;
  readonly erreurs: Promise<string>;
  arreter(): void;
}

export type LanceurTunnel = (args: string[]) => ProcessusTunnel;

export interface Planificateur {
  planifier(fonction: () => void, ms: number): unknown;
  annuler(minuterie: unknown): void;
}

export interface DependancesTunnels {
  readonly cibles: () => CibleTunnel[];
  readonly portPostes: number;
  readonly surChangement: (id: string) => void;
  readonly journal?: Logger;
  readonly lanceur?: LanceurTunnel;
  readonly planificateur?: Planificateur;
  readonly maintenant?: () => number;
}

export const ATTENTE_MIN_MS = 2_000;
export const ATTENTE_MAX_MS = 30_000;
/** Un tunnel resté ouvert au moins ce temps repart de l'attente minimale à sa prochaine chute. */
export const VIE_STABLE_MS = 30_000;

/** Arguments du tunnel inverse : options du contrat, puis la connexion de la fiche (comme ssh.ts). */
export function argumentsTunnel(c: ConnexionSsh, portDistant: number, portPostes: number): string[] {
  return [
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=2',
    '-o', 'ControlMaster=no',
    '-o', 'ControlPath=none',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'IdentitiesOnly=yes',
    '-i', c.cle,
    '-p', String(c.port),
    '-R', `127.0.0.1:${portDistant}:127.0.0.1:${portPostes}`,
    `${c.utilisateur}@${c.hote}`,
  ];
}

/** Attente avant la relance n (0 pour la première) : 2 s, 4 s, 8 s… plafonnée à 30 s. */
export function attenteRelance(essais: number): number {
  return Math.min(ATTENTE_MAX_MS, ATTENTE_MIN_MS * 2 ** essais);
}

/** Dernière ligne non vide d'une sortie d'erreur (le message de ssh). */
export function derniereLigne(texte: string): string {
  return texte.split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
}

/**
 * Phrase lisible pour le détail d'accès : jamais l'hôte, l'adresse, le port ni l'utilisateur (le message brut de ssh
 * les contient, il reste dans le journal local).
 */
export function phraseSsh(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('remote port forwarding failed') || m.includes('address already in use')) return 'port distant déjà pris';
  if (m.includes('connection refused')) return 'connexion refusée';
  if (m.includes('timed out')) return 'délai dépassé';
  if (m.includes('permission denied')) return 'authentification refusée';
  if (m.includes('could not resolve') || m.includes('name or service not known')) return 'hôte inconnu';
  return 'tunnel coupé';
}

interface Entree {
  readonly cible: CibleTunnel;
  processus: ProcessusTunnel | null;
  minuterie: unknown;
  essais: number;
  ouvertDepuis: number;
  detail: string | null;
}

function memeConnexion(a: CibleTunnel, b: CibleTunnel): boolean {
  const x = a.connexion;
  const y = b.connexion;
  return (
    a.portDistant === b.portDistant &&
    x.hote === y.hote &&
    x.port === y.port &&
    x.utilisateur === y.utilisateur &&
    x.cle === y.cle
  );
}

// Sous Linux, `setpriv --pdeathsig TERM` lie chaque tunnel à la vie du moteur : si le moteur meurt (appli tuée,
// plantage), le noyau arrête le `ssh`. Sans cela, l'ancien tunnel orphelin gardait le port distant et le poste de la
// machine ne retrouvait plus l'appli relancée (« port distant déjà pris », 22/11/2026).
const SETPRIV = process.platform === 'linux' ? Bun.which('setpriv') : null;

/** La commande d'un tunnel : `ssh`, lié à la vie du moteur quand le système le permet. */
export function commandeTunnel(args: readonly string[], setpriv: string | null = SETPRIV): string[] {
  return setpriv ? [setpriv, '--pdeathsig', 'TERM', 'ssh', ...args] : ['ssh', ...args];
}

/** Le vrai lanceur : un processus `ssh` par tunnel. Un lancement impossible devient une sortie en échec. */
export const lancerTunnelSsh: LanceurTunnel = (args) => {
  try {
    const p = Bun.spawn(commandeTunnel(args), { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' });
    return {
      pid: p.pid,
      sortie: p.exited,
      erreurs: new Response(p.stderr).text(),
      arreter: () => p.kill(),
    };
  } catch (e) {
    return { pid: -1, sortie: Promise.resolve(-1), erreurs: Promise.resolve(String(e)), arreter: () => undefined };
  }
};

const PLANIFICATEUR_DEFAUT: Planificateur = {
  planifier: (fonction, ms) => setTimeout(fonction, ms),
  annuler: (minuterie) => clearTimeout(minuterie as ReturnType<typeof setTimeout>),
};

export class Tunnels {
  private readonly entrees = new Map<string, Entree>();
  private readonly lanceur: LanceurTunnel;
  private readonly planificateur: Planificateur;
  private readonly maintenant: () => number;

  constructor(private readonly d: DependancesTunnels) {
    this.lanceur = d.lanceur ?? lancerTunnelSsh;
    this.planificateur = d.planificateur ?? PLANIFICATEUR_DEFAUT;
    this.maintenant = d.maintenant ?? (() => Date.now());
  }

  /** Aligne les tunnels sur les cibles : création, relance si la connexion change, arrêt si la machine disparaît. */
  synchroniser(): void {
    const cibles = this.d.cibles();
    const ids = new Set(cibles.map((c) => c.id));
    for (const id of [...this.entrees.keys()]) if (!ids.has(id)) this.arreter(id);
    for (const cible of cibles) {
      const existante = this.entrees.get(cible.id);
      if (existante && memeConnexion(existante.cible, cible)) continue;
      if (existante) this.arreter(cible.id);
      this.creer(cible);
    }
  }

  /** Vrai tant que le processus ssh tourne ; le détail dit pourquoi il ne tourne pas (phrase lisible, jamais le message brut). */
  etat(id: string): { readonly ouvert: boolean; readonly detail: string | null } {
    const e = this.entrees.get(id);
    if (!e) return { ouvert: false, detail: 'tunnel non démarré' };
    return { ouvert: e.processus !== null, detail: e.detail };
  }

  arreter(id: string): void {
    const e = this.entrees.get(id);
    if (!e) return;
    this.entrees.delete(id);
    this.annulerRelance(e);
    e.processus?.arreter();
    this.d.journal?.info({ machine: id, pid: e.processus?.pid }, 'tunnel SSH arrêté');
    this.d.surChangement(id);
  }

  /** À l'arrêt du relais : tous les processus ssh partent, sans relance. */
  arreterTout(): void {
    for (const e of this.entrees.values()) {
      this.annulerRelance(e);
      e.processus?.arreter();
    }
    this.entrees.clear();
  }

  /** Les processus ssh ouverts, par machine : l'inventaire du poste local y reconnaît ses tunnels. */
  pids(): { readonly id: string; readonly pid: number }[] {
    return [...this.entrees.values()].flatMap((e) => (e.processus ? [{ id: e.cible.id, pid: e.processus.pid }] : []));
  }

  /** Relance immédiate (le port distant vient d'être libéré) : le ssh en cours part, l'attente repart de zéro. */
  relancer(id: string): void {
    const e = this.entrees.get(id);
    if (!e) return;
    this.annulerRelance(e);
    e.processus?.arreter();
    e.processus = null;
    e.essais = 0;
    this.demarrer(e);
  }

  private annulerRelance(e: Entree): void {
    if (e.minuterie === null) return;
    this.planificateur.annuler(e.minuterie);
    e.minuterie = null;
  }

  private creer(cible: CibleTunnel): void {
    const e: Entree = { cible, processus: null, minuterie: null, essais: 0, ouvertDepuis: 0, detail: null };
    this.entrees.set(cible.id, e);
    this.demarrer(e);
  }

  private demarrer(e: Entree): void {
    const { id, portDistant } = e.cible;
    const p = this.lanceur(argumentsTunnel(e.cible.connexion, portDistant, this.d.portPostes));
    e.processus = p;
    e.minuterie = null;
    e.ouvertDepuis = this.maintenant();
    e.detail = null;
    this.d.journal?.info({ machine: id, pid: p.pid, portDistant }, 'tunnel SSH ouvert');
    this.d.surChangement(id);
    void p.sortie.then((code) => this.termine(e, p, code, p.erreurs));
  }

  private async termine(e: Entree, p: ProcessusTunnel, code: number, erreurs: Promise<string>): Promise<void> {
    if (this.entrees.get(e.cible.id) !== e || e.processus !== p) return;
    const brut = derniereLigne(await erreurs.catch(() => ''));
    if (this.entrees.get(e.cible.id) !== e || e.processus !== p) return;
    const message = phraseSsh(brut);
    if (this.maintenant() - e.ouvertDepuis >= VIE_STABLE_MS) e.essais = 0;
    const attente = attenteRelance(e.essais);
    e.essais += 1;
    e.processus = null;
    e.detail = `${message} — relance dans ${Math.round(attente / 1000)} s`;
    this.d.journal?.warn({ machine: e.cible.id, code, brut, attenteMs: attente }, 'tunnel SSH tombé, relance programmée');
    e.minuterie = this.planificateur.planifier(() => this.redemarrerApresAttente(e), attente);
    this.d.surChangement(e.cible.id);
  }

  private redemarrerApresAttente(e: Entree): void {
    if (this.entrees.get(e.cible.id) !== e) return;
    this.demarrer(e);
  }
}
