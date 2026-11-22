// Responsabilité : un tunnel `ssh -L` monté et tenu par le nœud vers une machine distante. Son port local devient une
// adresse directe (`127.0.0.1:port`) pour le pair qui y répond. Le nœud le relance s'il tombe et le coupe à l'arrêt ;
// l'identité de l'hôte est vérifiée contre un known_hosts du dossier de secrets (jamais ~/.ssh), la clé est dédiée.
import type { Logger } from 'pino';

export interface TunnelSshConfig {
  readonly hote: string;
  readonly port: number;
  readonly utilisateur: string;
  readonly cle: string;
  readonly portLocal: number;
  readonly portDistant: number;
}

const HOTE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const UTILISATEUR = /^[a-z_][a-z0-9_-]{0,31}$/;
const CLE = /^\/[A-Za-z0-9._/-]{1,400}$/;
const DELAI_RELANCE_MS = 5_000;

const port = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 65535;

/** Un tunnel est acceptable seulement si chaque champ a une forme sûre (rien ne commence par un tiret). */
export function tunnelSshValide(t: TunnelSshConfig): boolean {
  return (
    HOTE.test(t.hote) &&
    UTILISATEUR.test(t.utilisateur) &&
    CLE.test(t.cle) &&
    port(t.port) &&
    port(t.portLocal) &&
    port(t.portDistant)
  );
}

export function argumentsTunnelSsh(t: TunnelSshConfig, knownHosts: string): string[] {
  return [
    '-N',
    '-T',
    '-L',
    `127.0.0.1:${t.portLocal}:127.0.0.1:${t.portDistant}`,
    '-p',
    String(t.port),
    '-i',
    t.cle,
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    `UserKnownHostsFile=${knownHosts}`,
    '-o',
    'ServerAliveInterval=15',
    `${t.utilisateur}@${t.hote}`,
  ];
}

export interface OptionsTunnelSsh {
  readonly commande: string;
  readonly knownHosts: string;
  readonly journal: Logger;
  readonly delaiRelanceMs?: number;
}

export class TunnelSsh {
  private processus: ReturnType<typeof Bun.spawn> | null = null;
  private arrete = true;
  private minuterie: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: TunnelSshConfig,
    private readonly options: OptionsTunnelSsh,
  ) {}

  get adresseLocale(): string {
    return `127.0.0.1:${this.config.portLocal}`;
  }

  get actif(): boolean {
    return this.processus !== null;
  }

  demarrer(): void {
    if (!this.arrete) return;
    this.arrete = false;
    this.lancer();
  }

  arreter(): void {
    this.arrete = true;
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    const processus = this.processus;
    this.processus = null;
    processus?.kill();
  }

  private lancer(): void {
    const args = argumentsTunnelSsh(this.config, this.options.knownHosts);
    try {
      const processus = Bun.spawn([this.options.commande, ...args], { stdout: 'ignore', stderr: 'ignore' });
      this.processus = processus;
      this.options.journal.info({ port: this.config.portLocal }, 'tunnel ssh monté');
      void processus.exited.then((code) => this.fini(processus, code));
    } catch (erreur) {
      this.options.journal.error({ err: erreur }, 'tunnel ssh : lancement impossible');
      this.reprogrammer();
    }
  }

  private fini(processus: ReturnType<typeof Bun.spawn>, code: number): void {
    if (this.processus !== processus) return;
    this.processus = null;
    this.options.journal.warn({ code, port: this.config.portLocal }, 'tunnel ssh tombé');
    this.reprogrammer();
  }

  private reprogrammer(): void {
    if (this.arrete) return;
    this.minuterie = setTimeout(() => this.lancer(), this.options.delaiRelanceMs ?? DELAI_RELANCE_MS);
  }
}
