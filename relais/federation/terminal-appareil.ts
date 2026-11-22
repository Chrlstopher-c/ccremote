// Responsabilité : le terminal d'une machine du nœud, ouvert par un appareil dans son canal. Le PTY reste sur le poste
// (le relais local, `TerminauxRelais`) ; sa sortie, sa saisie, ses tailles et sa fin passent par le canal chiffré,
// comme le WebSocket direct. Une fenêtre en mémoire par terminal : rien n'est journalisé du contenu.
import type { ClientTerminal, DonneesTerminal } from '../appareils/terminaux.ts';
import type { CanalNoeud } from './canal.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import type { TerminauxLocaux } from './terminal-federe.ts';
import type { RequeteDroit } from '../../commun/charte.ts';

type Ouverture = Extract<MessageChiffre, { t: 'terminal_poste' }>;

interface Ouvert {
  readonly canal: CanalNoeud;
  readonly ws: ClientTerminal<DonneesTerminal>;
  erreur: string | null;
}

export class TerminalAppareil {
  private readonly ouverts = new Map<string, Ouvert>();

  constructor(
    private readonly locaux: () => TerminauxLocaux | null,
    private readonly autorise: (membre: string, requete: RequeteDroit) => boolean,
  ) {}

  /** Ouvre le terminal sur le poste ; la réponse `reponse` dit si le PTY est là, et sa raison sinon. */
  async ouvrir(canal: CanalNoeud, m: Ouverture): Promise<void> {
    if (!this.autorise(canal.membre, { genre: 'terminal' })) {
      return this.repondre(canal, m.ref, false, 'droit refusé : piloter');
    }
    const locaux = this.locaux();
    if (!locaux) return this.repondre(canal, m.ref, false, 'terminaux non disponibles ici');
    const entree: Ouvert = { canal, ws: this.adaptateur(canal, m), erreur: null };
    this.ouverts.set(m.terminal, entree);
    const ok = await locaux.ouvert(entree.ws);
    if (!ok) this.ouverts.delete(m.terminal);
    this.repondre(canal, m.ref, ok, ok ? undefined : (entree.erreur ?? 'terminal refusé par le poste'));
  }

  /** La saisie, les tailles et la fermeture d'un terminal de machine ; faux si ce terminal n'est pas le sien. */
  recu(canal: CanalNoeud, message: MessageChiffre): boolean {
    if (message.t !== 'terminal_entree' && message.t !== 'terminal_taille' && message.t !== 'terminal_fermer') {
      return false;
    }
    const entree = this.ouverts.get(message.terminal);
    if (!entree || entree.canal.membre !== canal.membre) return false;
    const locaux = this.locaux();
    if (message.t === 'terminal_entree') {
      locaux?.recu(entree.ws, Buffer.from(message.base64, 'base64'));
    } else if (message.t === 'terminal_taille') {
      locaux?.recu(entree.ws, JSON.stringify({ type: 'taille', colonnes: message.colonnes, lignes: message.lignes }));
    } else {
      this.ouverts.delete(message.terminal);
      locaux?.ferme(entree.ws);
    }
    return true;
  }

  /** Un lien tombe : les terminaux de cet appareil se ferment sur le poste. */
  fermerPour(membre: string): void {
    const locaux = this.locaux();
    for (const [terminal, entree] of [...this.ouverts]) {
      if (entree.canal.membre !== membre) continue;
      this.ouverts.delete(terminal);
      locaux?.ferme(entree.ws);
    }
  }

  // Le terminal du relais écrit dans un « WebSocket » : ici, chaque écriture devient un message du canal.
  private adaptateur(canal: CanalNoeud, m: Ouverture): ClientTerminal<DonneesTerminal> {
    const terminal = m.terminal;
    const data: DonneesTerminal = {
      type: 'terminal',
      terminal,
      machine: m.machine,
      cible: m.cible,
      colonnes: m.colonnes,
      lignes: m.lignes,
    };
    return {
      data,
      send: (donnees) => {
        const entree = this.ouverts.get(terminal);
        if (typeof donnees !== 'string') {
          return void canal.envoyer({ t: 'terminal_sortie', terminal, base64: Buffer.from(donnees).toString('base64') });
        }
        const json = lireObjet(donnees);
        if (json?.type === 'erreur' && typeof json.message === 'string' && entree) entree.erreur = json.message;
        if (json?.type === 'fin') {
          this.ouverts.delete(terminal);
          canal.envoyer({ t: 'terminal_fin', terminal, code: typeof json.code === 'number' ? json.code : null });
        }
        return undefined;
      },
      close: () => {
        this.ouverts.delete(terminal);
      },
    };
  }

  private repondre(canal: CanalNoeud, ref: string, ok: boolean, raison?: string): void {
    canal.envoyer({ t: 'reponse', ref, ok, ...(raison !== undefined ? { raison } : {}) });
  }
}

function lireObjet(texte: string): Record<string, unknown> | null {
  try {
    const brut: unknown = JSON.parse(texte);
    return brut && typeof brut === 'object' ? (brut as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
