// Responsabilité : lancer `ssh` vers une machine configurée (sans shell local, arguments en tableau) et rendre son résultat.
// Le lanceur est injectable : les tests jouent un faux `ssh` sans toucher au réseau.
import type { Logger } from 'pino';

export interface ConnexionSsh {
  readonly hote: string;
  readonly port: number;
  readonly utilisateur: string;
  readonly cle: string;
}

export interface ResultatSsh {
  readonly code: number;
  readonly sortie: string;
  readonly erreurs: string;
  readonly delaiDepasse: boolean;
}

export type Lanceur = (args: string[], entree: Uint8Array | null, delaiMs: number) => Promise<ResultatSsh>;

export const CODE_SSH_INJOIGNABLE = 255;

export function argumentsSsh(c: ConnexionSsh, commande: string | null): string[] {
  const options = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'ServerAliveInterval=15',
    '-i', c.cle,
    '-p', String(c.port),
  ];
  const cible = `${c.utilisateur}@${c.hote}`;
  return commande === null ? [...options, cible] : [...options, cible, commande];
}

/** Le vrai lanceur : un processus `ssh` par appel, tué au-delà du délai. */
export const lancerSsh: Lanceur = async (args, entree, delaiMs) => {
  const processus = Bun.spawn(['ssh', ...args], {
    stdin: entree ? 'pipe' : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let delaiDepasse = false;
  const minuterie = setTimeout(() => {
    delaiDepasse = true;
    processus.kill();
  }, delaiMs);
  try {
    if (entree && processus.stdin) {
      processus.stdin.write(entree);
      await processus.stdin.end();
    }
    const [sortie, erreurs, code] = await Promise.all([
      new Response(processus.stdout).text(),
      new Response(processus.stderr).text(),
      processus.exited,
    ]);
    return { code, sortie, erreurs, delaiDepasse };
  } finally {
    clearTimeout(minuterie);
  }
};

export class Ssh {
  constructor(
    private readonly lanceur: Lanceur = lancerSsh,
    private readonly journal?: Logger,
  ) {}

  /** Exécute une commande distante (chaîne déjà quotée par le module appelant) et rend le résultat, sans exception. */
  async executer(c: ConnexionSsh, commande: string, entree: Uint8Array | null = null, delaiMs = 30_000): Promise<ResultatSsh> {
    try {
      return await this.lanceur(argumentsSsh(c, commande), entree, delaiMs);
    } catch (e) {
      this.journal?.warn({ hote: c.hote, err: e }, 'ssh : lancement impossible');
      return { code: -1, sortie: '', erreurs: String(e), delaiDepasse: false };
    }
  }
}
