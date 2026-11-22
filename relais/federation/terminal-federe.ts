// Responsabilité : le terminal d'une session tenue par un autre nœud. Le PTY reste chez ce nœud ; son flux traverse
// le lien chiffré (terminal_ouvrir, saisie, taille, fermeture, sortie, fin). Celui qui ouvre (WebSocket de l'appli)
// relaie la frappe et l'affichage ; celui qui tient la session ouvre un terminal local dans son dossier. Rien n'est
// journalisé du contenu.
import type { Logger } from 'pino';
import { type MessageChiffre } from '../../commun/federation.ts';
import { MessageClientTerminal } from '../../commun/appareil.ts';
import type { ClientTerminal, DonneesTerminal } from '../appareils/terminaux.ts';
import type { CanalNoeud } from './canal.ts';
import type { Canaux } from './canaux.ts';
import type { Echanges } from './echanges.ts';
import type { Registre } from '../registre/registre.ts';

/** Délai d'une ouverture de terminal chez le pair (le poste doit lancer son shell). */
const DELAI_OUVERTURE_MS = 20_000;
const CODE_LIEN_PERDU = 4410;

/** Les terminaux locaux qu'un pair peut ouvrir : ceux du relais (une seule instance par nœud). */
export interface TerminauxLocaux {
  ouvert(ws: ClientTerminal): Promise<boolean>;
  recu(ws: ClientTerminal, message: string | Buffer): void;
  ferme(ws: ClientTerminal): void;
}

/** Données d'un terminal ouvert par l'appli sur une session d'un pair (WebSocket `/api/sessions/:id/terminal`). */
export interface DonneesTerminalFedere {
  readonly type: 'terminal-federe';
  readonly terminal: string;
  readonly membre: string;
  readonly session: string;
  readonly colonnes: number;
  readonly lignes: number;
}

export interface OptionsTerminalFedere {
  readonly echanges: Echanges;
  readonly canaux: Pick<Canaux, 'liaisonOuverteAvec'>;
  readonly registre: Pick<Registre, 'session'>;
  readonly journal: Logger;
}

interface Demandeur {
  readonly membre: string;
  readonly ws: ClientTerminal<DonneesTerminalFedere>;
}

interface Tenu {
  readonly membre: string;
  readonly ws: ClientTerminal<DonneesTerminal>;
}

export class TerminalFedere {
  private locaux: TerminauxLocaux | null = null;
  /** Terminaux ouverts par l'appli sur un pair (côté qui demande), par identifiant de terminal. */
  private readonly demandes = new Map<string, Demandeur>();
  /** Terminaux que le pair a ouverts sur une session de ce nœud (côté qui tient la session). */
  private readonly tenus = new Map<string, Tenu>();

  constructor(private readonly o: OptionsTerminalFedere) {}

  /** Les terminaux du relais, pour ouvrir les PTY des sessions de ce nœud à la demande d'un pair. */
  brancher(locaux: TerminauxLocaux): void {
    this.locaux = locaux;
  }

  /** Les terminaux du relais, une fois branchés (les terminaux de machine d'un appareil y passent aussi). */
  get locauxBranches(): TerminauxLocaux | null {
    return this.locaux;
  }

  // ---- Côté qui demande (WebSocket de l'appli) ----------------------------------------------------------------

  /** Ouvre le terminal chez le pair : la réponse du pair dit si le PTY est là ; sinon le WebSocket est fermé. */
  async ouvrir(ws: ClientTerminal<DonneesTerminalFedere>): Promise<void> {
    const { membre, session, terminal, colonnes, lignes } = ws.data;
    const canal = this.o.canaux.liaisonOuverteAvec(membre);
    if (!canal) return this.refuser(ws, 'machine hors ligne : la session est sur un autre nœud du réseau');
    this.demandes.set(terminal, { membre, ws });
    const reponse = await this.o.echanges.requeter(
      canal,
      (ref) => ({ t: 'terminal_ouvrir', ref, terminal, session, colonnes, lignes }),
      DELAI_OUVERTURE_MS,
    );
    if (reponse?.t === 'reponse' && reponse.ok) return;
    this.demandes.delete(terminal);
    this.refuser(ws, reponse?.t === 'reponse' ? (reponse.raison ?? 'terminal refusé') : 'le nœud n’a pas répondu');
  }

  /** La frappe (binaire) et les tailles (texte JSON) de l'appli, relayées au pair. */
  recu(ws: ClientTerminal<DonneesTerminalFedere>, message: string | Buffer): void {
    const demande = this.demandes.get(ws.data.terminal);
    const canal = demande ? this.o.canaux.liaisonOuverteAvec(demande.membre) : null;
    if (!demande || !canal) return;
    const { terminal } = ws.data;
    if (typeof message !== 'string') {
      canal.envoyer({ t: 'terminal_entree', terminal, base64: Buffer.from(message).toString('base64') });
      return;
    }
    const taille = lireTaille(message);
    if (taille) canal.envoyer({ t: 'terminal_taille', terminal, colonnes: taille.colonnes, lignes: taille.lignes });
  }

  /** Le WebSocket de l'appli part : le pair ferme son PTY. */
  ferme(ws: ClientTerminal<DonneesTerminalFedere>): void {
    const demande = this.demandes.get(ws.data.terminal);
    if (!demande) return;
    this.demandes.delete(ws.data.terminal);
    this.o.canaux.liaisonOuverteAvec(demande.membre)?.envoyer({ t: 'terminal_fermer', terminal: ws.data.terminal });
  }

  // ---- Messages du pair ---------------------------------------------------------------------------------------

  /** Un message `terminal_*` reçu d'un pair sur le lien chiffré. */
  traiter(canal: CanalNoeud, message: MessageChiffre): void {
    switch (message.t) {
      case 'terminal_ouvrir':
        return void this.ouvrirChezNous(canal, message);
      case 'terminal_entree': {
        const octets = Buffer.from(message.base64, 'base64');
        return this.surTenu(canal, message.terminal, (t) => this.locaux?.recu(t.ws, octets));
      }
      case 'terminal_taille': {
        const taille = JSON.stringify({ type: 'taille', colonnes: message.colonnes, lignes: message.lignes });
        return this.surTenu(canal, message.terminal, (t) => this.locaux?.recu(t.ws, taille));
      }
      case 'terminal_fermer':
        return this.surTenu(canal, message.terminal, (t) => this.fermerTenu(message.terminal, t));
      case 'terminal_sortie':
        return this.surDemande(canal, message.terminal, (d) => d.ws.send(Buffer.from(message.base64, 'base64')));
      case 'terminal_fin':
        return this.surDemande(canal, message.terminal, (d) => this.finDemande(message.terminal, d, message.code));
      default:
        return undefined;
    }
  }

  /** Un lien tombe : les terminaux qui passaient par ce pair se ferment, des deux côtés. */
  fermerPour(membre: string): void {
    for (const [terminal, d] of [...this.demandes]) {
      if (d.membre !== membre) continue;
      this.demandes.delete(terminal);
      this.refuser(d.ws, 'lien avec la machine perdu', CODE_LIEN_PERDU);
    }
    for (const [terminal, t] of [...this.tenus]) {
      if (t.membre !== membre) continue;
      this.fermerTenu(terminal, t);
    }
  }

  // ---- Côté qui tient la session ------------------------------------------------------------------------------

  private async ouvrirChezNous(
    canal: CanalNoeud,
    m: Extract<MessageChiffre, { t: 'terminal_ouvrir' }>,
  ): Promise<void> {
    // Une session du duo n'est pas un terminal de ce nœud : seules les sessions propres s'ouvrent à un pair.
    if (!this.locaux) return this.o.echanges.reponse(canal, m.ref, false, 'terminaux non disponibles ici');
    const fiche = this.o.registre.session(m.session);
    if (!fiche || fiche.duo) return this.o.echanges.reponse(canal, m.ref, false, 'session inconnue');
    const data: DonneesTerminal = {
      type: 'terminal',
      terminal: m.terminal,
      machine: fiche.machine,
      cible: { type: 'shell', dossier: fiche.cwd },
      colonnes: m.colonnes,
      lignes: m.lignes,
    };
    const ws = this.paireDe(canal, data);
    this.tenus.set(m.terminal, { membre: canal.membre, ws });
    const ouvert = await this.locaux.ouvert(ws);
    if (!ouvert) this.tenus.delete(m.terminal);
    this.o.echanges.reponse(canal, m.ref, ouvert, ouvert ? undefined : 'terminal refusé par le poste');
  }

  // Le terminal local vit sans WebSocket : sa sortie et sa fin repartent vers le pair par le lien.
  private paireDe(canal: CanalNoeud, data: DonneesTerminal): ClientTerminal<DonneesTerminal> {
    const terminal = data.terminal;
    return {
      data,
      send: (donnees) => {
        if (typeof donnees !== 'string') {
          const base64 = Buffer.from(donnees).toString('base64');
          return void canal.envoyer({ t: 'terminal_sortie', terminal, base64 });
        }
        const fin = lireFin(donnees);
        if (!fin) return undefined;
        this.tenus.delete(terminal);
        canal.envoyer({ t: 'terminal_fin', terminal, code: fin.code });
      },
      close: () => undefined,
    };
  }

  private surTenu(canal: CanalNoeud, terminal: string, action: (t: Tenu) => void): void {
    const t = this.tenus.get(terminal);
    if (t && t.membre === canal.membre) action(t);
  }

  private fermerTenu(terminal: string, t: Tenu): void {
    this.tenus.delete(terminal);
    this.locaux?.ferme(t.ws);
  }

  // ---- Retours vers l'appli -----------------------------------------------------------------------------------

  private surDemande(canal: CanalNoeud, terminal: string, action: (d: Demandeur) => void): void {
    const d = this.demandes.get(terminal);
    if (d && d.membre === canal.membre) action(d);
  }

  private finDemande(terminal: string, d: Demandeur, code: number | null): void {
    this.demandes.delete(terminal);
    d.ws.send(JSON.stringify({ type: 'fin', code }));
    d.ws.close(1000, 'terminal terminé');
  }

  private refuser(ws: ClientTerminal<DonneesTerminalFedere>, raison: string, code = 4409): void {
    ws.send(JSON.stringify({ type: 'erreur', message: raison }));
    ws.close(code, raison);
  }
}

/** Un WebSocket ouvert pour un terminal relayé (session d'un pair), et non pour un poste local. */
export function estTerminalFedere(
  ws: { readonly data: { readonly type: string } },
): ws is { readonly data: DonneesTerminalFedere } {
  return ws.data.type === 'terminal-federe';
}

function lireTaille(texte: string): { colonnes: number; lignes: number } | null {
  try {
    const r = MessageClientTerminal.safeParse(JSON.parse(texte));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

function lireFin(texte: string): { code: number | null } | null {
  try {
    const brut: unknown = JSON.parse(texte);
    if (!brut || typeof brut !== 'object' || !('type' in brut) || brut.type !== 'fin') return null;
    const code = 'code' in brut && typeof brut.code === 'number' ? brut.code : null;
    return { code };
  } catch {
    return null;
  }
}
