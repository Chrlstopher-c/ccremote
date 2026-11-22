// Responsabilité : les briques du lancement d'un serveur de module sur le poste — commande bornée (systemd-run), port
// libre sur 127.0.0.1, environnement, empreinte des fichiers serveur/, attente qu'il écoute. Ne garde aucun processus.
import { createHash } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import { DOSSIER_SERVEUR } from '../../../commun/modules.ts';
import type { FichierLu } from '../validation.ts';

const PERIODE_SONDE_MS = 100;

/**
 * La commande qui lance le serveur : Bun, borné en mémoire, en CPU et en priorité par systemd-run sous Linux. Sous
 * macOS, pas de systemd ni de limite de mémoire par processus : `nice` seul.
 */
export function commandeSysteme(point: string, plateforme: NodeJS.Platform = process.platform): string[] {
  if (plateforme === 'darwin') return ['nice', '-n', '10', 'bun', 'run', point];
  return [
    'systemd-run',
    '--user',
    '--scope',
    '-q',
    '-p',
    'MemoryMax=1G',
    '-p',
    'CPUQuota=100%',
    '--',
    'nice',
    '-n',
    '10',
    'bun',
    'run',
    point,
  ];
}

export interface ParamsEnvironnement {
  readonly id: string;
  readonly port: number;
  readonly donnees: string;
}

/** Variables du serveur : PORT, MODULE_ID, MODULE_DONNEES, plus ce qu'il faut à systemd-run --user. */
export function environnementServeur(p: ParamsEnvironnement): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    PORT: String(p.port),
    MODULE_ID: p.id,
    MODULE_DONNEES: p.donnees,
  };
  for (const cle of ['XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
    const valeur = process.env[cle];
    if (valeur) env[cle] = valeur;
  }
  return env;
}

/** Un port libre sur 127.0.0.1 (réservé le temps de rendre le numéro). */
export function portLibre(): Promise<number> {
  return new Promise((resoudre, rejeter) => {
    const serveur = createServer();
    serveur.once('error', rejeter);
    serveur.listen(0, '127.0.0.1', () => {
      const adresse = serveur.address();
      serveur.close(() => {
        if (typeof adresse === 'object' && adresse !== null) resoudre(adresse.port);
        else rejeter(new Error('port introuvable'));
      });
    });
  });
}

/** Vrai dès qu'une connexion à 127.0.0.1:port réussit ; faux au délai, ou dès que `continuer` rend faux. */
export async function attendrePort(port: number, delaiMs: number, continuer: () => boolean): Promise<boolean> {
  const fin = Date.now() + delaiMs;
  while (continuer() && Date.now() < fin) {
    if (await sonder(port)) return true;
    await Bun.sleep(PERIODE_SONDE_MS);
  }
  return false;
}

function sonder(port: number): Promise<boolean> {
  return new Promise((resoudre) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resoudre(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resoudre(false);
    });
  });
}

// Fichiers de `serveur/` qui comptent pour son code (hors dépendances, exclues ; bun.lock produit par l'installation).
const GENERES = new Set([`${DOSSIER_SERVEUR}/bun.lock`]);

/** Empreinte des fichiers de `serveur/` : change si le code du serveur change, pas si l'installation touche au lock. */
export function empreinteServeur(fichiers: readonly FichierLu[]): string {
  const hache = createHash('sha256');
  const serveur = fichiers.filter((f) => f.chemin.startsWith(`${DOSSIER_SERVEUR}/`) && !GENERES.has(f.chemin));
  for (const f of serveur.sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0))) {
    hache.update(`${f.chemin}\0`).update(f.octets).update('\0');
  }
  return hache.digest('hex');
}

/** Arrêt d'un processus lancé par nous : SIGTERM, puis SIGKILL si rien après `delaiMs`. */
export async function tuer(proc: Bun.Subprocess, delaiMs: number): Promise<void> {
  proc.kill('SIGTERM');
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<false>((resoudre) => {
    minuterie = setTimeout(() => resoudre(false), delaiMs);
  });
  const arrive = await Promise.race([proc.exited.then(() => true), delai]);
  clearTimeout(minuterie);
  if (arrive) return;
  proc.kill('SIGKILL');
  await proc.exited;
}
