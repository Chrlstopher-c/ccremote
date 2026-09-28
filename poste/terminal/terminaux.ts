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

export function commandeDe(cible: CibleTerminal): string[] {
  if (cible.type === 'tmux') return ['tmux', '-L', 'claude', '-u', 'attach', '-t', `=${cible.tmux}`];
  const shell = process.env['SHELL'] || userInfo().shell || '/bin/bash';
  return [shell, '-l'];
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
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TMUX: undefined },
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
