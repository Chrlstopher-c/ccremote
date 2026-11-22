// Responsabilité : un appareil client (genre « appareil ») relié à un nœud par l'aiguilleur réel. Appairage
// accepté au nœud, canal chiffré, API clients servie dans le canal ; identité inconnue refusée ; révocation coupe
// le canal. Le
// relais ne voit que des trames chiffrées (charges observées au nœud = ce que l'aiguilleur transporte).
import { expect, test } from 'bun:test';
import pino from 'pino';
import { type MessageVersAiguilleur, analyserDeAiguilleur, CHEMIN_APPAIRAGE_MEMBRE } from '../../commun/aiguilleur.ts';
import { exporterIdentitePublique, genererIdentite, type Identite } from '../../commun/chiffrement/identite.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import {
  attendre,
  codeAppairage,
  creerNoeud,
  monterAiguilleur,
  type Monte,
  type Noeud,
  relier,
} from './banc-federation.ts';
import { CanalNoeud, type HoteCanal, type PresentationDistante } from './canal.ts';
import { servirAppareil } from './appareils.ts';
import type { TableInterne } from './executeur.ts';
import type { PairFederee } from './secrets.ts';

const silencieux = pino({ enabled: false });
const MAJ = '2026-11-22T10:00:00.000Z';
const PROPRIETAIRE = 'chris';
/** Seuls ces types de message (en clair) peuvent transiter : toute API est dans des trames `chiffre`. */
const CLAIR_AUTORISE = /^(presentation|accord|refus|poignee|poignee-reponse|chiffre|fermer)$/;

const TABLE: TableInterne = {
  '/api/etat': { GET: () => Response.json({ machine: 'tour' }) },
  '/api/federation/aiguilleur': { POST: () => new Response('jamais') },
};

interface Reponse {
  readonly statut: number;
  readonly corps: string;
}

/** Un appareil de test : identité propre, membre de l'aiguilleur, machine à états du canal côté appareil. */
class Appareil {
  readonly canaux = new Map<string, CanalNoeud>();
  readonly ouverts: string[] = [];
  readonly fermes: string[] = [];
  readonly refusees: string[] = [];
  pairs: PairFederee[] = [];
  membre = '';
  private ws: WebSocket | null = null;
  private readonly reponses = new Map<string, (r: Reponse) => void>();
  private compteur = 0;

  constructor(readonly identite: Identite) {}

  /** Appairage à l'aiguilleur par code (membre appareil), puis lien sortant authentifié. */
  async rejoindre(monte: Monte, code: string): Promise<void> {
    const r = await fetch(`${monte.url}${CHEMIN_APPAIRAGE_MEMBRE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        nom: 'iphone',
        genre: 'appareil',
        cle: exporterIdentitePublique(this.identite.publique),
      }),
    });
    const corps = (await r.json()) as { id: string; jeton: string };
    this.membre = corps.id;
    const url = `${monte.url.replace('http', 'ws')}/aiguilleur`;
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${corps.jeton}` } });
    ws.onmessage = (ev) => this.recevoirAiguilleur(String(ev.data));
    await new Promise<void>((ok, ko) => {
      ws.onopen = () => ok();
      ws.onerror = () => ko(new Error('lien aiguilleur refusé'));
    });
    this.ws = ws;
  }

  ouvrir(id: string, vers: string, intention: 'appairage' | 'lien'): CanalNoeud {
    const canal = new CanalNoeud(id, vers, intention, 'ouvrant', this.hote());
    this.canaux.set(id, canal);
    this.envoyer({ t: 'ouvrir', canal: id, vers });
    return canal;
  }

  /** Une requête de l'API clients dans le canal ; statut 0 si le canal est fermé. */
  appeler(canal: CanalNoeud, chemin: string): Promise<Reponse> {
    this.compteur += 1;
    const ref = `r${this.compteur}`;
    return new Promise((ok) => {
      this.reponses.set(ref, ok);
      if (!canal.envoyer({ t: 'api', ref, methode: 'GET', chemin })) {
        this.reponses.delete(ref);
        ok({ statut: 0, corps: '' });
      }
    });
  }

  private envoyer(message: MessageVersAiguilleur): boolean {
    this.ws?.send(JSON.stringify(message));
    return true;
  }

  private recevoirAiguilleur(brut: string): void {
    const message = analyserDeAiguilleur(JSON.parse(brut));
    if (!message) return;
    if (message.t === 'accepter') return void this.canaux.get(message.canal)?.surAccepter();
    if (message.t === 'refuser') return this.canaux.get(message.canal)?.surRefus();
    if (message.t === 'donnees') return void this.canaux.get(message.canal)?.surDonnees(message.charge);
    if (message.t === 'fermer') return this.canaux.get(message.canal)?.surFermetureDistante();
  }

  private recevoir(canal: CanalNoeud, message: MessageChiffre): void {
    if (message.t === 'api_reponse') {
      return this.reponses.get(message.ref)?.({ statut: message.statut, corps: message.corps });
    }
    if (message.t === 'revocation') canal.fermer();
  }

  private hote(): HoteCanal {
    return {
      journal: silencieux,
      delaiAppairageMs: 5000,
      identiteLocale: async () => this.identite,
      nomLocal: () => 'iphone',
      genreLocal: () => 'appareil',
      pairDe: (membre) => this.pairs.find((p) => p.id === membre) ?? null,
      envoyerAiguilleur: (m) => this.envoyer(m),
      presentationRecue: () => undefined,
      appairageAccepte: (canal, p: PresentationDistante) => {
        this.pairs = [...this.pairs.filter((x) => x.id !== canal.membre), {
          id: canal.membre, nom: p.nom, identite: p.identite, creeLe: MAJ, genre: 'noeud',
        }];
      },
      appairageRefuse: () => undefined,
      liaisonOuverte: (canal) => void this.ouverts.push(canal.id),
      liaisonRefusee: (_canal, raison) => void this.refusees.push(raison),
      messageRecu: (canal, m) => this.recevoir(canal, m),
      canalFerme: (canal) => {
        this.canaux.delete(canal.id);
        this.fermes.push(canal.id);
      },
    };
  }
}

async function nouveauNoeud(monte: Monte) {
  const noeud = creerNoeud('tour', { servirAppareil: servirAppareil(TABLE, silencieux) });
  const id = await relier(noeud, monte, PROPRIETAIRE);
  await attendre(async () => (await noeud.federation.etat()).aiguilleur?.relie === true);
  return { noeud, id };
}

async function appareilAvecCode(monte: Monte): Promise<Appareil> {
  const appareil = new Appareil(await genererIdentite());
  await appareil.rejoindre(monte, codeAppairage(monte, PROPRIETAIRE));
  return appareil;
}

async function appairerAppareil(monte: Monte, noeud: Noeud, id: string) {
  const appareil = await appareilAvecCode(monte);
  const canal = appareil.ouvrir('ap-1', id, 'appairage');
  await attendre(async () => (await noeud.federation.etat()).demandes.some((d) => d.genre === 'appareil'));
  const demande = (await noeud.federation.etat()).demandes.find((d) => d.genre === 'appareil');
  noeud.federation.decider(demande?.id ?? '', true);
  await attendre(() => appareil.ouverts.includes('ap-1'));
  return { appareil, canal };
}

test('un appareil accepté au nœud reçoit l’API clients dans son canal chiffré', async () => {
  const monte = monterAiguilleur();
  const { noeud, id } = await nouveauNoeud(monte);
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    expect(await appareil.appeler(canal, '/api/etat')).toEqual({
      statut: 200,
      corps: JSON.stringify({ machine: 'tour' }),
    });
    expect((await appareil.appeler(canal, '/api/federation/aiguilleur')).statut).toBe(403);
    for (const charge of noeud.charges) {
      const message: unknown = JSON.parse(charge);
      expect(message).toMatchObject({ t: expect.stringMatching(CLAIR_AUTORISE) });
    }
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});

test('une identité non acceptée au nœud ne peut pas ouvrir de canal', async () => {
  const monte = monterAiguilleur();
  const { noeud, id } = await nouveauNoeud(monte);
  const intrus = await appareilAvecCode(monte);
  try {
    const inconnue = exporterIdentitePublique((await genererIdentite()).publique);
    intrus.pairs = [{ id, nom: 'tour', identite: inconnue, creeLe: MAJ, genre: 'noeud' }];
    const canal = intrus.ouvrir('lien-1', id, 'lien');
    await attendre(() => intrus.refusees.length > 0);
    expect(intrus.ouverts).not.toContain('lien-1');
    expect(await intrus.appeler(canal, '/api/etat')).toEqual({ statut: 0, corps: '' });
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});

test('révoquer un appareil coupe son canal et refuse tout nouveau lien', async () => {
  const monte = monterAiguilleur();
  const { noeud, id } = await nouveauNoeud(monte);
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    expect((await noeud.federation.revoquer(appareil.membre)).ok).toBe(true);
    await attendre(() => appareil.fermes.includes('ap-1'));
    expect(await appareil.appeler(canal, '/api/etat')).toEqual({ statut: 0, corps: '' });
    appareil.ouvrir('lien-2', id, 'lien');
    await attendre(() => appareil.refusees.length > 0);
    expect(appareil.ouverts).toEqual(['ap-1']);
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});
