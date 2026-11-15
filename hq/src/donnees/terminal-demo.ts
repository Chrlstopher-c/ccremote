// Responsabilité : le terminal de la démo — une session interactive simulée (saisie, retour arrière, Ctrl+C) qui répond
// via shell-demo. Même contrat que le terminal du relais, sans réseau ni processus réel.
import { PROJET_DEMO } from './arbre-demo';
import { estDossierDemo, executerCommande } from './shell-demo';
import {
  type BilanTerminal,
  type FabriqueTerminal,
  type OptionsOuverture,
  type SessionTerminal,
  Tampon,
} from './terminal';

const ECHAP = '\u001b';
const EFFACER_ECRAN = '\u001b[2J\u001b[H';
const RETOUR_ARRIERE = ['\b', '\u007f'];

export const fabriqueTerminalDemo: FabriqueTerminal = (options) => new TerminalDemo(options);

class TerminalDemo implements SessionTerminal {
  private readonly sortie = new Tampon<string>();
  private readonly fin = new Tampon<BilanTerminal>();
  private readonly machine: string;
  private cwd: string;
  private ligne = '';
  private ferme = false;

  constructor(options: OptionsOuverture) {
    this.machine = options.machine;
    const dossier = options.cible.type === 'shell' ? options.cible.dossier : undefined;
    this.cwd = dossier && estDossierDemo(dossier) ? dossier : PROJET_DEMO;
    const session = options.cible.type === 'tmux' ? `session tmux « ${options.cible.tmux} » (démo)` : 'shell (démo)';
    this.emettre(`${session} sur ${this.machine}\r\n${this.invite()}`);
  }

  surSortie(f: (texte: string) => void): void {
    this.sortie.abonner(f);
  }

  surFin(f: (bilan: BilanTerminal) => void): void {
    this.fin.abonner(f);
  }

  ecrire(texte: string): void {
    if (this.ferme || texte.startsWith(ECHAP)) return;
    for (const caractere of texte) this.toucher(caractere);
  }

  // La démo n'a pas de rendu à adapter : la taille est sans effet.
  redimensionner(): void {}

  fermer(): void {
    this.ferme = true;
  }

  private toucher(caractere: string): void {
    if (caractere === '\r' || caractere === '\n') this.valider();
    else if (RETOUR_ARRIERE.includes(caractere)) this.effacerDernier();
    else if (caractere === '\u0003') this.interrompre();
    else if (caractere >= ' ') {
      this.ligne += caractere;
      this.emettre(caractere);
    }
  }

  private valider(): void {
    const { sortie, cwd, effacer } = executerCommande(this.ligne, this.cwd);
    this.ligne = '';
    this.cwd = cwd;
    const debut = effacer ? EFFACER_ECRAN : '\r\n';
    const corps = sortie === '' ? '' : `${sortie.replace(/\n/g, '\r\n')}\r\n`;
    this.emettre(`${debut}${corps}${this.invite()}`);
  }

  private effacerDernier(): void {
    if (this.ligne === '') return;
    this.ligne = this.ligne.slice(0, -1);
    this.emettre('\b \b');
  }

  private interrompre(): void {
    this.ligne = '';
    this.emettre(`^C\r\n${this.invite()}`);
  }

  private invite(): string {
    return `${this.machine}:${this.cwd}$ `;
  }

  private emettre(texte: string): void {
    this.sortie.emettre(texte);
  }
}
