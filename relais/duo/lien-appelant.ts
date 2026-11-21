// Responsabilité : le côté qui appelle du lien duo — l'appairage ponctuel (code saisi) et la connexion permanente vers
// le relais du pair, rétablie avec recul. S'arrête net sur un refus d'authentification.
import type { MessageLien } from '../../commun/duo.ts';
import { type Canal, CHEMIN_LIEN, lireMessage } from './lien-commun.ts';
import { nonce, preuve, preuveValide } from './preuve.ts';

export const RAISON_INJOIGNABLE = 'pair injoignable';

export type ResultatAppairageDistant =
  { ok: true; paire: string; cle: string; utilisateur: string } | { ok: false; raison: string };

export function appairerAupres(
  adresse: string,
  code: string,
  utilisateur: string,
  delaiMs: number,
): Promise<ResultatAppairageDistant> {
  return new Promise((resoudre) => {
    const ws = new WebSocket(`ws://${adresse}${CHEMIN_LIEN}`);
    const terminer = (r: ResultatAppairageDistant): void => {
      clearTimeout(minuterie);
      resoudre(r);
      ws.close();
    };
    const minuterie = setTimeout(() => terminer({ ok: false, raison: RAISON_INJOIGNABLE }), delaiMs);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'appairage', code, utilisateur }));
    ws.onmessage = (ev) => {
      const m = lireMessage(String(ev.data));
      if (m?.type === 'appairage_ok') terminer({ ok: true, paire: m.paire, cle: m.cle, utilisateur: m.utilisateur });
      else if (m?.type === 'refus') terminer({ ok: false, raison: m.raison });
    };
    ws.onerror = () => terminer({ ok: false, raison: RAISON_INJOIGNABLE });
    ws.onclose = () => terminer({ ok: false, raison: RAISON_INJOIGNABLE });
  });
}

export interface PontAppel {
  cleDe(paire: string): string | null;
  liaison(canal: Canal): void;
  recevoir(paire: string, m: MessageLien): void;
  fermee(canal: Canal): void;
  refus(raison: string): void;
}

export interface DelaisAppel {
  readonly min: number;
  readonly max: number;
}

export class LienAppelant implements Canal {
  private ws: WebSocket | null = null;
  private authentifie = false;
  private nonceLocal = '';
  private cle = '';
  private delai: number;
  private minuterie: ReturnType<typeof setTimeout> | null = null;
  private arrete = true;

  constructor(
    private readonly adresse: string,
    private readonly paire: string,
    private readonly pont: PontAppel,
    private readonly delais: DelaisAppel,
  ) {
    this.delai = delais.min;
  }

  demarrer(): void {
    this.arrete = false;
    this.connecter();
  }

  arreter(): void {
    this.arrete = true;
    if (this.minuterie) clearTimeout(this.minuterie);
    this.ws?.close();
  }

  // Coupure réseau : le lien tombe, la reconnexion suit son recul.
  couper(): void {
    this.ws?.close();
  }

  envoyer(m: MessageLien): void {
    this.ws?.send(JSON.stringify(m));
  }

  fermer(): void {
    this.ws?.close();
  }

  private connecter(): void {
    const cle = this.pont.cleDe(this.paire);
    if (!cle) return this.arreter();
    this.cle = cle;
    this.nonceLocal = nonce();
    this.authentifie = false;
    const ws = new WebSocket(`ws://${this.adresse}${CHEMIN_LIEN}`);
    this.ws = ws;
    ws.onopen = () => this.envoyer({ type: 'lien', paire: this.paire, nonce: this.nonceLocal });
    ws.onmessage = (ev) => this.recevoirBrut(String(ev.data));
    ws.onclose = () => this.fermeture(ws);
    ws.onerror = () => undefined; // la fermeture qui suit porte la suite
  }

  private recevoirBrut(brut: string): void {
    const m = lireMessage(brut);
    if (!m) return;
    if (this.authentifie) return this.pont.recevoir(this.paire, m);
    this.recevoirAuth(m);
  }

  private recevoirAuth(m: MessageLien): void {
    if (m.type === 'defi') {
      if (!preuveValide(preuve(this.cle, 'serveur', this.nonceLocal, this.paire), m.preuve)) {
        return this.refuserPar('clé de la paire non reconnue');
      }
      this.envoyer({ type: 'preuve', preuve: preuve(this.cle, 'client', m.nonce, this.paire) });
    } else if (m.type === 'lien_ok') {
      this.authentifie = true;
      this.delai = this.delais.min;
      this.pont.liaison(this);
    } else if (m.type === 'refus') {
      this.refuserPar(m.raison);
    }
  }

  private refuserPar(raison: string): void {
    this.arrete = true;
    this.pont.refus(raison);
    this.ws?.close();
  }

  private fermeture(ws: WebSocket): void {
    if (ws !== this.ws) return;
    this.ws = null;
    if (this.authentifie) this.pont.fermee(this);
    this.authentifie = false;
    if (this.arrete) return;
    this.minuterie = setTimeout(() => this.connecter(), this.delai);
    this.delai = Math.min(this.delai * 2, this.delais.max);
  }
}
