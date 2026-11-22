// Responsabilité : le découpage d'une réponse en flux pour un appareil — morceaux base64 bornés à une trame, rangs dans
// l'ordre, fin annonçant leur nombre ; canal fermé en route : le flux amont est relâché, la fin est ok=faux.
import { expect, test } from 'bun:test';
import pino from 'pino';
import type { MessageChiffre } from '../../commun/federation.ts';
import { servirAppareil } from './appareils.ts';
import { envoyerReponseFlux, OCTETS_MORCEAU_FLUX } from './reponse-flux-appareil.ts';

const silencieux = pino({ enabled: false });

/** Un flux qui livre les blocs donnés, un par lecture, et signale son annulation. */
function fluxDe(blocs: Uint8Array[]): { flux: ReadableStream<Uint8Array>; annule: () => boolean } {
  let rang = 0;
  let annule = false;
  const flux = new ReadableStream<Uint8Array>({
    pull(controleur) {
      if (rang === blocs.length) return controleur.close();
      controleur.enqueue(blocs[rang] ?? new Uint8Array());
      rang += 1;
    },
    cancel() {
      annule = true;
    },
  });
  return { flux, annule: () => annule };
}

function octetsDe(blocs: Uint8Array[]): Uint8Array {
  const sortie = new Uint8Array(blocs.reduce((n, b) => n + b.byteLength, 0));
  let decalage = 0;
  for (const b of blocs) {
    sortie.set(b, decalage);
    decalage += b.byteLength;
  }
  return sortie;
}

test('un flux découpé en morceaux de trame : rangs dans l’ordre, base64 exact, fin qui annonce le nombre', async () => {
  const blocs = [new Uint8Array(1), new Uint8Array(OCTETS_MORCEAU_FLUX + 1), new Uint8Array(10_000).fill(7)];
  const envoyes: MessageChiffre[] = [];
  const { flux } = fluxDe(blocs);
  await envoyerReponseFlux((m) => (envoyes.push(m), true), 'r1', { statut: 200, type: 'audio/L16', flux }, silencieux);

  expect(envoyes[0]).toEqual({ t: 'api_flux', ref: 'r1', statut: 200, type: 'audio/L16' });
  const morceaux = envoyes.slice(1, -1) as Extract<MessageChiffre, { t: 'morceau' }>[];
  expect(morceaux.every((m) => m.t === 'morceau' && m.corps.length <= 4096)).toBe(true);
  expect(morceaux.map((m) => m.rang)).toEqual(morceaux.map((_, i) => i));
  const reunis = Buffer.concat(morceaux.map((m) => Buffer.from(m.corps, 'base64')));
  expect(reunis.equals(Buffer.from(octetsDe(blocs)))).toBe(true);
  expect(envoyes.at(-1)).toEqual({ t: 'api_fin', ref: 'r1', morceaux: morceaux.length, ok: true });
});

test('un canal qui se ferme en route : le flux amont est relâché et la fin est ok=faux', async () => {
  const blocs = Array.from({ length: 6 }, (_, i) => new Uint8Array(OCTETS_MORCEAU_FLUX).fill(i));
  const envoyes: MessageChiffre[] = [];
  const { flux, annule } = fluxDe(blocs);
  await envoyerReponseFlux(
    (m) => {
      if (envoyes.length >= 3) return false;
      envoyes.push(m);
      return true;
    },
    'r2',
    { statut: 200, type: 'audio/L16', flux },
    silencieux,
  );
  expect(annule()).toBe(true);
  expect(envoyes.some((m) => m.t === 'api_fin')).toBe(false);
});

test('servirAppareil ne rend en flux que la réponse binaire d’une requête flux=1 ; le reste reste entier', async () => {
  const table = {
    '/api/son': { POST: () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/L16' } }) },
    '/api/texte': { POST: () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }) },
  };
  const servir = servirAppareil(table, silencieux);
  const enFlux = await servir({ methode: 'POST', chemin: '/api/son?flux=1' });
  expect(enFlux.flux).toBeDefined();
  expect(enFlux.type).toBe('audio/L16');
  expect(enFlux.corps).toBe('');
  const entier = await servir({ methode: 'POST', chemin: '/api/son' });
  expect(entier.flux).toBeUndefined();
  expect(entier.codage).toBe('base64');
  const texte = await servir({ methode: 'POST', chemin: '/api/texte?flux=1' });
  expect(texte).toEqual({ statut: 200, corps: '{"ok":true}' });
});
