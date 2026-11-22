// Responsabilité : la synthèse vocale en flux jusqu'à un appareil, dans le canal chiffré de l'aiguilleur réel. Un
// service de voix factice (PCM au fil de la génération, MP3 entier sans `flux`) derrière la vraie route `/api/voix`.
// Vérifie : les octets réunis, le premier morceau avant la fin, la coupure signalée, le repli entier sans flux.
import { expect, test } from 'bun:test';
import pino from 'pino';
import { ApiVoix } from '../voix/api-voix.ts';
import { monterAiguilleur } from './banc-federation.ts';
import { appairerAppareil, nouveauNoeud } from './banc-appareil.ts';
import type { TableInterne } from './executeur.ts';

const PAS_MS = 120;
const BLOCS = 5;
const TAILLE_BLOC = 5000;
const TYPE_PCM = 'audio/L16;rate=24000;channels=1';
const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function bloc(rang: number): Uint8Array {
  return new Uint8Array(TAILLE_BLOC).fill(rang + 1);
}

function concat(blocs: Uint8Array[]): Uint8Array {
  const sortie = new Uint8Array(blocs.reduce((n, b) => n + b.byteLength, 0));
  let decalage = 0;
  for (const b of blocs) {
    sortie.set(b, decalage);
    decalage += b.byteLength;
  }
  return sortie;
}

/** Service de voix factice : `flux` → PCM un bloc tous les PAS_MS ; sinon le MP3 entier après la même durée. */
function serviceFactice(): { url: string; arreter: () => void } {
  const serveur = Bun.serve({
    port: 0,
    async fetch(req) {
      const corps = (await req.json()) as { texte: string; flux?: boolean };
      if (!corps.flux) {
        await pause(PAS_MS * BLOCS);
        return new Response(concat([bloc(0), bloc(1)]), { headers: { 'content-type': 'audio/mpeg' } });
      }
      const coupure = corps.texte.includes('coupure');
      let rang = 0;
      const flux = new ReadableStream<Uint8Array>({
        async pull(controleur) {
          await pause(PAS_MS);
          if (coupure && rang === 2) return controleur.error(new Error('coupure du service'));
          if (rang === BLOCS) return controleur.close();
          controleur.enqueue(bloc(rang));
          rang += 1;
        },
      });
      return new Response(flux, { headers: { 'content-type': TYPE_PCM } });
    },
  });
  return { url: `http://127.0.0.1:${serveur.port}`, arreter: () => serveur.stop(true) };
}

/** Un nœud servant `/api/voix` avec la vraie route, branchée sur le service factice. */
async function noeudAvecVoix(monte: ReturnType<typeof monterAiguilleur>, url: string) {
  const voix = new ApiVoix(url, { voixDesPairs: async () => null }, pino({ enabled: false }));
  const table: TableInterne = { '/api/voix': { POST: (req) => voix.synthese(req) } };
  return nouveauNoeud(monte, table);
}

test('en flux, le premier morceau arrive dans l’appareil avant la fin, et les octets réunis sont exacts', async () => {
  const service = serviceFactice();
  const monte = monterAiguilleur();
  const { noeud, id } = await noeudAvecVoix(monte, service.url);
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    const reponse = await appareil.appelerFlux(canal, '/api/voix?flux=1', JSON.stringify({ texte: 'bonjour' }));
    expect(reponse.statut).toBe(200);
    expect(reponse.type).toBe(TYPE_PCM);
    expect(reponse.ok).toBe(true);
    const attendu = concat(Array.from({ length: BLOCS }, (_, r) => bloc(r)));
    expect(Buffer.from(reponse.octets).equals(Buffer.from(attendu))).toBe(true);
    expect(reponse.premierMs).not.toBeNull();
    expect(reponse.premierMs ?? Infinity).toBeLessThan(reponse.finMs - PAS_MS * 2);
    const premier = Math.round(reponse.premierMs ?? 0);
    console.log(`voix flux : premier morceau à ${premier} ms, fin à ${Math.round(reponse.finMs)} ms`);
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
    service.arreter();
  }
});

test('sans flux, la même route rend le MP3 entier, comme avant', async () => {
  const service = serviceFactice();
  const monte = monterAiguilleur();
  const { noeud, id } = await noeudAvecVoix(monte, service.url);
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    const debut = performance.now();
    const corps = JSON.stringify({ texte: 'bonjour' });
    const reponse = await appareil.appeler(canal, '/api/voix', { methode: 'POST', corps });
    const duree = performance.now() - debut;
    expect(reponse.statut).toBe(200);
    expect(reponse.corps).toBe(Buffer.from(concat([bloc(0), bloc(1)])).toString('base64'));
    expect(reponse.codage).toBe('base64');
    expect(reponse.type).toBe('audio/mpeg');
    console.log(`voix entière : réponse complète à ${Math.round(duree)} ms`);
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
    service.arreter();
  }
});

test('une coupure du service pendant le flux est signalée à l’appareil (flux incomplet, pas complet)', async () => {
  const service = serviceFactice();
  const monte = monterAiguilleur();
  const { noeud, id } = await noeudAvecVoix(monte, service.url);
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    const reponse = await appareil.appelerFlux(canal, '/api/voix?flux=1', JSON.stringify({ texte: 'coupure' }));
    expect(reponse.statut).toBe(200);
    expect(reponse.ok).toBe(false);
    expect(reponse.octets.byteLength).toBeLessThan(BLOCS * TAILLE_BLOC);
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
    service.arreter();
  }
});

test('un service de voix absent : l’erreur entière passe par le flux (statut 503, pas de morceau)', async () => {
  const monte = monterAiguilleur();
  const { noeud, id } = await noeudAvecVoix(monte, 'http://127.0.0.1:9');
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    const reponse = await appareil.appelerFlux(canal, '/api/voix?flux=1', JSON.stringify({ texte: 'bonjour' }));
    expect(reponse.statut).toBe(503);
    expect(reponse.ok).toBe(true);
    expect(reponse.octets.byteLength).toBeGreaterThan(0);
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});
