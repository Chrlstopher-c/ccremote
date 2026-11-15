// Responsabilité : le terminal à distance du monde — une session interactive (shell ou tmux) sur un poste, vue comme
// un flux de texte. Côté relais : un WebSocket sur /api/terminal (saisie en octets, redimensionnement en JSON,
// sortie en octets, fin en JSON). La démo a sa propre implémentation (terminal-demo.ts) derrière le même contrat.
import type { CibleTerminal } from './contrat';
import { journaliser } from './journal';
import { type FabriqueSocket, PROTOCOLE_FLUX } from './transport-flux';

export interface BilanTerminal {
  readonly code: number | null;
  readonly erreur: string | null;
}

export interface SessionTerminal {
  surSortie(f: (texte: string) => void): void;
  surFin(f: (bilan: BilanTerminal) => void): void;
  ecrire(texte: string): void;
  redimensionner(colonnes: number, lignes: number): void;
  fermer(): void;
}

export interface OptionsOuverture {
  readonly machine: string;
  readonly cible: CibleTerminal;
  readonly colonnes: number;
  readonly lignes: number;
}

export type FabriqueTerminal = (options: OptionsOuverture) => SessionTerminal;

export interface OptionsTerminalRelais {
  readonly base: string;
  readonly jeton: string;
  readonly fabrique: FabriqueSocket;
}

/** Diffusion à un seul écouteur : ce qui arrive avant l'abonnement est retenu, pas perdu. */
export class Tampon<T> {
  private ecouteur: ((valeur: T) => void) | null = null;
  private retenus: T[] = [];

  emettre(valeur: T): void {
    if (!this.ecouteur) {
      this.retenus.push(valeur);
      return;
    }
    try {
      this.ecouteur(valeur);
    } catch (erreur) {
      journaliser('error', 'écouteur de terminal en erreur', { erreur: String(erreur) });
    }
  }

  abonner(f: (valeur: T) => void): void {
    this.ecouteur = f;
    const retenus = this.retenus;
    this.retenus = [];
    for (const valeur of retenus) this.emettre(valeur);
  }
}

export function ouvrirTerminalRelais(options: OptionsTerminalRelais): FabriqueTerminal {
  return (ouverture) =>
    new TerminalRelais(urlTerminal(options.base, ouverture), options.jeton, options.fabrique, ouverture);
}

export function urlTerminal(base: string, ouverture: OptionsOuverture): string {
  const parametres = new URLSearchParams({
    machine: ouverture.machine,
    colonnes: String(ouverture.colonnes),
    lignes: String(ouverture.lignes),
  });
  const { cible } = ouverture;
  if (cible.type === 'tmux') parametres.set('tmux', cible.tmux);
  else if (cible.dossier) parametres.set('dossier', cible.dossier);
  const racine = base.replace(/\/+$/, '').replace(/^http/, 'ws');
  return `${racine}/api/terminal?${parametres.toString()}`;
}

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null;
}

// Un message texte du poste (relayé) : fin de terminal ou erreur. Tout autre texte n'a pas de sens ici.
function bilanDuMessage(brut: string): BilanTerminal | null {
  let donnees: unknown;
  try {
    donnees = JSON.parse(brut);
  } catch (erreur) {
    journaliser('warn', 'message de terminal illisible', { erreur: String(erreur) });
    return null;
  }
  if (!estObjet(donnees)) return null;
  if (donnees['type'] === 'fin') {
    const code = donnees['code'];
    return { code: typeof code === 'number' ? code : null, erreur: null };
  }
  if (donnees['type'] === 'erreur') {
    const message = donnees['message'];
    return { code: null, erreur: typeof message === 'string' ? message : 'erreur du terminal' };
  }
  return null;
}

class TerminalRelais implements SessionTerminal {
  private readonly sortie = new Tampon<string>();
  private readonly fin = new Tampon<BilanTerminal>();
  private readonly decodeur = new TextDecoder();
  private readonly encodeur = new TextEncoder();
  private readonly socket: WebSocket;
  private ouvert = false;
  private termine = false;
  private fermetureVoulue = false;
  private attente: Uint8Array[] = [];
  private tailleEnAttente: { colonnes: number; lignes: number } | null = null;

  constructor(
    url: string,
    jeton: string,
    fabrique: FabriqueSocket,
    private readonly ouverture: OptionsOuverture,
  ) {
    this.socket = fabrique(url, [PROTOCOLE_FLUX, jeton]);
    this.socket.binaryType = 'arraybuffer';
    this.socket.onopen = () => this.ouvrir();
    this.socket.onmessage = (e: MessageEvent) => this.recevoir(e.data);
    this.socket.onerror = () => journaliser('warn', 'terminal à distance en erreur', { machine: ouverture.machine });
    this.socket.onclose = () => this.coupure();
  }

  surSortie(f: (texte: string) => void): void {
    this.sortie.abonner(f);
  }

  surFin(f: (bilan: BilanTerminal) => void): void {
    this.fin.abonner(f);
  }

  ecrire(texte: string): void {
    if (this.termine) return;
    const octets = this.encodeur.encode(texte);
    if (this.ouvert) this.socket.send(octets);
    else this.attente.push(octets);
  }

  redimensionner(colonnes: number, lignes: number): void {
    if (this.termine) return;
    if (!this.ouvert) {
      this.tailleEnAttente = { colonnes, lignes };
      return;
    }
    this.socket.send(JSON.stringify({ type: 'taille', colonnes, lignes }));
  }

  fermer(): void {
    if (this.termine) return;
    this.fermetureVoulue = true;
    this.termine = true;
    this.socket.close(1000, 'fermé par Agent HQ');
  }

  private ouvrir(): void {
    this.ouvert = true;
    for (const octets of this.attente) this.socket.send(octets);
    this.attente = [];
    if (this.tailleEnAttente) this.redimensionner(this.tailleEnAttente.colonnes, this.tailleEnAttente.lignes);
    this.tailleEnAttente = null;
  }

  private recevoir(donnees: unknown): void {
    if (typeof donnees === 'string') {
      const bilan = bilanDuMessage(donnees);
      if (bilan) this.terminer(bilan);
      return;
    }
    if (donnees instanceof ArrayBuffer) {
      this.sortie.emettre(this.decodeur.decode(new Uint8Array(donnees), { stream: true }));
      return;
    }
    journaliser('warn', 'donnée de terminal inattendue', { machine: this.ouverture.machine });
  }

  private coupure(): void {
    if (!this.fermetureVoulue) this.terminer({ code: null, erreur: 'connexion interrompue' });
  }

  private terminer(bilan: BilanTerminal): void {
    if (this.termine) return;
    this.termine = true;
    this.fin.emettre(bilan);
  }
}
