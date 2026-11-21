// Responsabilité : le côté qui écoute du lien duo — un WebSocket sur son port à part. Il reçoit un appairage ou une
// demande de lien, prouve qu'il connaît la clé de la paire, puis transmet les messages au mode duo.
import type { Server, ServerWebSocket } from 'bun';
import type { MessageLien } from '../../commun/duo.ts';
import { type Canal, CHEMIN_LIEN, lireMessage } from './lien-commun.ts';
import { nonce, preuve, preuveValide } from './preuve.ts';

export type ResultatAppairage = { ok: true; paire: string; cle: string } | { ok: false; raison: string };

// Ce que le mode duo offre au lien entrant.
export interface PontEntrant {
  readonly utilisateur: string;
  appairer(code: string, utilisateurDistant: string): ResultatAppairage;
  cleDe(paire: string): string | null;
  liaison(canal: Canal): void;
  recevoir(paire: string, m: MessageLien): void;
  fermee(canal: Canal): void;
}

interface DonneesSocket {
  lien: LienEntrant | null;
}

export type ServeurDuo = Server<DonneesSocket>;

export class LienEntrant implements Canal {
  private etat: 'attente' | 'defi' | 'lien' = 'attente';
  private paire = '';
  private nonceDefi = '';

  constructor(
    private readonly ws: ServerWebSocket<DonneesSocket>,
    private readonly pont: PontEntrant,
  ) {}

  envoyer(m: MessageLien): void {
    this.ws.send(JSON.stringify(m));
  }

  fermer(): void {
    this.ws.close();
  }

  recevoir(brut: string): void {
    const m = lireMessage(brut);
    if (!m) return this.refuser('message illisible');
    if (this.etat === 'lien') return this.pont.recevoir(this.paire, m);
    if (m.type === 'appairage' && this.etat === 'attente') return this.appairer(m.code, m.utilisateur);
    if (m.type === 'lien' && this.etat === 'attente') return this.demanderLien(m.paire, m.nonce);
    if (m.type === 'preuve' && this.etat === 'defi') return this.verifier(m.preuve);
    this.refuser('étape inattendue');
  }

  // Socket fermé : seul un lien authentifié est signalé au mode duo.
  fermee(): void {
    if (this.etat === 'lien') this.pont.fermee(this);
  }

  private appairer(code: string, utilisateur: string): void {
    const r = this.pont.appairer(code, utilisateur);
    if (!r.ok) return this.refuser(r.raison);
    this.envoyer({ type: 'appairage_ok', paire: r.paire, cle: r.cle, utilisateur: this.pont.utilisateur });
    this.ws.close();
  }

  private demanderLien(paire: string, nonceDistant: string): void {
    const cle = this.pont.cleDe(paire);
    if (!cle) return this.refuser('paire inconnue');
    this.paire = paire;
    this.nonceDefi = nonce();
    this.etat = 'defi';
    this.envoyer({ type: 'defi', nonce: this.nonceDefi, preuve: preuve(cle, 'serveur', nonceDistant, paire) });
  }

  private verifier(recue: string): void {
    const cle = this.pont.cleDe(this.paire);
    if (!cle || !preuveValide(preuve(cle, 'client', this.nonceDefi, this.paire), recue)) {
      return this.refuser('authentification');
    }
    this.etat = 'lien';
    this.envoyer({ type: 'lien_ok', utilisateur: this.pont.utilisateur });
    this.pont.liaison(this);
  }

  private refuser(raison: string): void {
    this.envoyer({ type: 'refus', raison });
    this.ws.close();
  }
}

export function ouvrirEcouteDuo(hote: string, port: number, pont: PontEntrant): ServeurDuo {
  return Bun.serve<DonneesSocket>({
    hostname: hote,
    port,
    fetch(req, serveur) {
      if (new URL(req.url).pathname !== CHEMIN_LIEN) return new Response('introuvable', { status: 404 });
      return serveur.upgrade(req, { data: { lien: null } })
        ? undefined
        : new Response('WebSocket attendu', { status: 426 });
    },
    websocket: {
      open: (ws) => {
        ws.data.lien = new LienEntrant(ws, pont);
      },
      message: (ws, m) => ws.data.lien?.recevoir(String(m)),
      close: (ws) => ws.data.lien?.fermee(),
      idleTimeout: 120,
      sendPings: true,
    },
  });
}
