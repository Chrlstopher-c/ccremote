// Responsabilité : les terminaux ouverts à distance sur la machine — un vrai PTY par terminal (un shell, ou un client
// attaché à une session Claude de `tmux -L claude`), dont la sortie part au relais et l'entrée en revient.
import { homedir, userInfo } from 'node:os';
import type { Logger } from 'pino';
import type { CibleTerminal } from '../../commun/appareil.ts';
import { cheminAbsolu, type Resultat } from '../fichiers/explorateur.ts';

const MAX_TERMINAUX = 12;
/** La sortie est regroupée sur ce laps : un `cat` d'un gros fichier ne doit pas émettre un message par octet. */
const REGROUPEMENT_MS = 12;

export interface SortieTerminaux {
  sortie(terminal: string, base64: string): void;
  fin(terminal: string, code: number | null): void;
}

interface Ouvert {
  readonly processus: Bun.Subprocess;
  tampon: Buffer[];
  minuteur: ReturnType<typeof setTimeout> | null;
}

/** Le compte qui fait tourner le poste : son shell de connexion et son dossier personnel viennent de passwd. */
function compteDuPoste(): { nom: string; accueil: string; shell: string } {
  const compte = userInfo();
  const shell = compte.shell && compte.shell.startsWith('/') ? compte.shell : '/bin/bash';
  return { nom: compte.username, accueil: compte.homedir, shell };
}

/**
 * Sans langue UTF-8 dans l'environnement du poste, zsh compte les glyphes Nerd Font en octets : le prompt se chevauche.
 * HOME, USER, LOGNAME et SHELL viennent du compte (passwd), jamais du lanceur : sous systemd ou un service, ils
 * manquent ou valent autre chose, et le shell perd la configuration de l'utilisateur (powerlevel10k). ZDOTDIR du
 * lanceur est retiré : zsh lit alors la configuration dans le dossier personnel.
 */
export function environnementDuTerminal(
  base: NodeJS.ProcessEnv,
  compte: { nom: string; accueil: string; shell: string } = compteDuPoste(),
): Record<string, string> {
  const env: Record<string, string> = { ...base, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  const effective = ['LC_ALL', 'LC_CTYPE', 'LANG'].map((nom) => base[nom]).find((v) => v && v !== '');
  if (!effective?.toLowerCase().includes('utf')) {
    env['LANG'] = 'C.UTF-8';
    for (const nom of ['LC_ALL', 'LC_CTYPE']) if (base[nom]) env[nom] = 'C.UTF-8';
  }
  env['HOME'] = compte.accueil;
  env['USER'] = compte.nom;
  env['LOGNAME'] = compte.nom;
  env['SHELL'] = compte.shell;
  delete env['ZDOTDIR'];
  delete env['TMUX'];
  return env;
}

export function commandeDe(cible: CibleTerminal): string[] {
  if (cible.type === 'tmux') return ['tmux', '-L', 'claude', '-u', 'attach', '-t', `=${cible.tmux}`];
  return [shellDeLUtilisateur(), '-il'];
}

/** Le shell de connexion du compte (passwd), jamais `$SHELL` : hérité du lanceur, il n'est pas celui de l'utilisateur. */
export function shellDeLUtilisateur(): string {
  return compteDuPoste().shell;
}

export class Terminaux {
  private readonly ouverts = new Map<string, Ouvert>();

  constructor(
    private readonly vers: SortieTerminaux,
    private readonly journal: Logger,
  ) {}

  ouvrir(terminal: string, cible: CibleTerminal, colonnes: number, lignes: number): Resultat {
    if (this.ouverts.has(terminal)) return { ok: true };
    if (this.ouverts.size >= MAX_TERMINAUX) return { ok: false, erreur: `${MAX_TERMINAUX} terminaux déjà ouverts` };
    const dossier = cible.type === 'shell' ? cheminAbsolu(cible.dossier) : homedir();
    const processus = Bun.spawn(commandeDe(cible), {
      cwd: dossier,
      env: environnementDuTerminal(process.env),
      terminal: { cols: colonnes, rows: lignes, data: (_t, octets) => this.recu(terminal, octets) },
    });
    this.ouverts.set(terminal, { processus, tampon: [], minuteur: null });
    this.journal.info({ terminal, cible }, 'terminal ouvert');
    void processus.exited.then((code) => this.termine(terminal, code));
    return { ok: true };
  }

  entree(terminal: string, base64: string): void {
    this.ouverts.get(terminal)?.processus.terminal?.write(Buffer.from(base64, 'base64'));
  }

  taille(terminal: string, colonnes: number, lignes: number): void {
    this.ouverts.get(terminal)?.processus.terminal?.resize(colonnes, lignes);
  }

  fermer(terminal: string): void {
    const t = this.ouverts.get(terminal);
    if (!t) return;
    // Fermer un client tmux le DÉTACHE : la session Claude continue. Un shell, lui, reçoit SIGHUP.
    t.processus.kill('SIGHUP');
  }

  fermerTout(): void {
    for (const id of this.ouverts.keys()) this.fermer(id);
  }

  private recu(terminal: string, octets: Uint8Array): void {
    const t = this.ouverts.get(terminal);
    if (!t) return;
    t.tampon.push(Buffer.from(octets));
    t.minuteur ??= setTimeout(() => this.vider(terminal), REGROUPEMENT_MS);
  }

  private vider(terminal: string): void {
    const t = this.ouverts.get(terminal);
    if (!t) return;
    t.minuteur = null;
    if (t.tampon.length === 0) return;
    const base64 = Buffer.concat(t.tampon).toString('base64');
    t.tampon = [];
    this.vers.sortie(terminal, base64);
  }

  private termine(terminal: string, code: number | null): void {
    this.vider(terminal);
    const t = this.ouverts.get(terminal);
    if (t?.minuteur) clearTimeout(t.minuteur);
    t?.processus.terminal?.close();
    this.ouverts.delete(terminal);
    this.journal.info({ terminal, code }, 'terminal fermé');
    this.vers.fin(terminal, code);
  }
}
