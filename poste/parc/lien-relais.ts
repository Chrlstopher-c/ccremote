// Responsabilité : le lien sortant du poste vers le relais — connexion authentifiée, reconnexion, file d'attente.
// Le poste initie toujours : il marche derrière un NAT, en 4G, sans port ouvert.
import type { Logger } from 'pino';
import { CommandeRelais, ENTETE_MACHINE, type MessagePoste } from '../../commun/protocole-poste.ts';

const TAILLE_TAMPON = 5_000;
const ATTENTE_MAX_MS = 30_000;

export interface ParametresLien {
  readonly url: string;
  readonly machine: string;
  readonly secret: string;
  readonly journal: Logger;
  readonly bonjour: () => MessagePoste;
  readonly surCommande: (c: CommandeRelais) => Promise<MessagePoste | null>;
}

export class LienRelais {
  private ws: WebSocket | null = null;
  private tampon: MessagePoste[] = [];
  private attenteMs = 1_000;
  private arrete = false;
  private ouvertA = 0;

  constructor(private readonly p: ParametresLien) {}

  demarrer(): void {
    this.connecter();
  }

  arreter(): void {
    this.arrete = true;
    this.ws?.close();
  }

  // Le flux en direct n'a de valeur que maintenant : perdu si le lien est coupé. Le reste est rejoué à la reconnexion.
  envoyer(m: MessagePoste): void {
    if (this.ws?.readyState === WebSocket.OPEN) return this.ws.send(JSON.stringify(m));
    if (m.kind === 'flux' || m.kind === 'etat_machine' || m.kind === 'terminal_sortie') return;
    this.tampon.push(m);
    if (this.tampon.length > TAILLE_TAMPON) this.tampon.shift();
  }

  private connecter(): void {
    // Bun accepte des en-têtes sur le client WebSocket : le secret ne passe jamais dans l'URL (logs Cloudflare).
    const options = { headers: { authorization: `Bearer ${this.p.secret}`, [ENTETE_MACHINE]: this.p.machine } };
    const ws = new WebSocket(this.p.url, options as unknown as string[]);
    this.ws = ws;
    ws.onopen = () => this.ouvert(ws);
    ws.onmessage = (e) => void this.recevoir(ws, String(e.data));
    ws.onclose = (e) => this.ferme(e.code, e.reason);
    ws.onerror = () => this.p.journal.warn({ url: this.p.url }, 'erreur du lien vers le relais');
  }

  private ouvert(ws: WebSocket): void {
    this.p.journal.info({ url: this.p.url }, 'lien au relais établi');
    this.ouvertA = Date.now();
    ws.send(JSON.stringify(this.p.bonjour()));
    const enAttente = this.tampon;
    this.tampon = [];
    for (const m of enAttente) ws.send(JSON.stringify(m));
  }

  private async recevoir(ws: WebSocket, brut: string): Promise<void> {
    let commande: CommandeRelais;
    try {
      commande = CommandeRelais.parse(JSON.parse(brut));
    } catch (erreur) {
      this.p.journal.warn({ err: erreur }, 'commande du relais illisible, ignorée');
      return;
    }
    const reponse = await this.p.surCommande(commande);
    if (reponse && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reponse));
  }

  private ferme(code: number, raison: string): void {
    this.ws = null;
    if (this.arrete) return;
    // Une connexion refusée aussitôt ouverte (secret faux, relais d'une autre version) ne remet pas l'attente à zéro.
    if (Date.now() - this.ouvertA > 10_000) this.attenteMs = 1_000;
    this.p.journal.warn({ code, raison, dansMs: this.attenteMs }, 'lien au relais perdu, reconnexion');
    setTimeout(() => this.connecter(), this.attenteMs);
    this.attenteMs = Math.min(this.attenteMs * 2, ATTENTE_MAX_MS);
  }
}
