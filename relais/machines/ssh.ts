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

/** `surLigne` : reçoit chaque ligne de la sortie standard pendant que la commande tourne (avancement). */
export type Lanceur = (
  args: string[],
  entree: Uint8Array | null,
  delaiMs: number,
  surLigne?: (ligne: string) => void,
) => Promise<ResultatSsh>;

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

/** Lit la sortie ligne à ligne, en la transmettant au fur et à mesure, et rend son texte entier. */
async function lireLignes(flux: ReadableStream<Uint8Array>, surLigne: (ligne: string) => void): Promise<string> {
  const lecteur = flux.getReader();
  const decodeur = new TextDecoder();
  let tout = '';
  let reste = '';
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    const morceau = decodeur.decode(value, { stream: true });
    tout += morceau;
    reste += morceau;
    let fin = reste.indexOf('\n');
    while (fin >= 0) {
      surLigne(reste.slice(0, fin));
      reste = reste.slice(fin + 1);
      fin = reste.indexOf('\n');
    }
  }
  const queue = decodeur.decode();
  tout += queue;
  reste += queue;
  if (reste) surLigne(reste);
  return tout;
}

/** Le vrai lanceur : un processus `ssh` par appel, tué au-delà du délai. */
export const lancerSsh: Lanceur = async (args, entree, delaiMs, surLigne) => {
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
    const sortie = surLigne ? lireLignes(processus.stdout, surLigne) : new Response(processus.stdout).text();
    const [texte, erreurs, code] = await Promise.all([
      sortie,
      new Response(processus.stderr).text(),
      processus.exited,
    ]);
    return { code, sortie: texte, erreurs, delaiDepasse };
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
  async executer(
    c: ConnexionSsh,
    commande: string,
    entree: Uint8Array | null = null,
    delaiMs = 30_000,
    surLigne?: (ligne: string) => void,
  ): Promise<ResultatSsh> {
    try {
      return await this.lanceur(argumentsSsh(c, commande), entree, delaiMs, surLigne);
    } catch (e) {
      this.journal?.warn({ hote: c.hote, err: e }, 'ssh : lancement impossible');
      return { code: -1, sortie: '', erreurs: String(e), delaiDepasse: false };
    }
  }
}
