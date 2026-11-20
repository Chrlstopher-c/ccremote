// Responsabilité : tests de la dictée du poste (P6) contre un faux démon de dictée (Unix socket dans un dossier
// temporaire) : état, découpage des morceaux de 1 s, `final`, erreurs du démon, absence du service.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { cheminSocketDictee, decouperAudio, etatDictee, OCTETS_MORCEAU_AUDIO, transcrire } from './dictee.ts';

const journal = pino({ level: 'silent' });
type Message = Record<string, unknown>;

let dossier = '';
let cheminNormal = '';
let cheminErreur = '';
const recus: Message[] = [];

// Faux démon : ping → pong, ouvrir → ouverte, fermer → final (ou erreur du modèle en mode `erreur`).
function faux(chemin: string, mode: 'normal' | 'erreur'): ReturnType<typeof Bun.listen> {
  let reste = Buffer.alloc(0);
  return Bun.listen({
    unix: chemin,
    socket: {
      data(socket, octets) {
        reste = Buffer.concat([reste, Buffer.from(octets)]);
        for (let fin = reste.indexOf(0x0a); fin >= 0; fin = reste.indexOf(0x0a)) {
          const m = JSON.parse(reste.subarray(0, fin).toString('utf8')) as Message;
          reste = reste.subarray(fin + 1);
          recus.push(m);
          const reponse = reponseDe(m, mode);
          if (reponse) socket.write(`${JSON.stringify(reponse)}\n`);
        }
      },
      open() {},
      close() {},
      error() {},
    },
  });
}

function reponseDe(m: Message, mode: 'normal' | 'erreur'): Message | null {
  if (m['op'] === 'ping') return { ev: 'pong', moteur: 'faux', version: 1 };
  if (m['op'] === 'ouvrir') return { ev: 'ouverte', session: m['session'] };
  if (m['op'] !== 'fermer') return null;
  if (mode === 'erreur') return { ev: 'erreur', session: null, message: 'modèle absent' };
  return { ev: 'final', session: m['session'], texte: 'bonjour le monde', ms: 3, reutilise: false, duree: 1 };
}

beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'dictee-'));
  cheminNormal = join(dossier, 'normal.sock');
  cheminErreur = join(dossier, 'erreur.sock');
  faux(cheminNormal, 'normal');
  faux(cheminErreur, 'erreur');
});

afterAll(() => {
  rmSync(dossier, { recursive: true, force: true });
});

describe('chemin du socket de dictée', () => {
  test('explicite, puis XDG_RUNTIME_DIR, puis repli sur l’uid', () => {
    expect(cheminSocketDictee({ LANTERNE_DICTEE_SOCKET: '/x/d.sock' }, 1000)).toBe('/x/d.sock');
    expect(cheminSocketDictee({ XDG_RUNTIME_DIR: '/run/u' }, 1000)).toBe('/run/u/dictee/moteur.sock');
    expect(cheminSocketDictee({}, 1000)).toBe('/run/user/1000/dictee/moteur.sock');
  });
});

describe('découpage de l’audio', () => {
  test('morceaux de 1 s (32 000 octets), le dernier plus court', () => {
    const tailles = decouperAudio(new Uint8Array(70_000)).map((m) => m.length);
    expect(OCTETS_MORCEAU_AUDIO).toBe(32_000);
    expect(tailles).toEqual([32_000, 32_000, 6_000]);
  });
});

describe('état du service', () => {
  test('socket absent : indisponible, avec la raison', async () => {
    expect(await etatDictee(join(dossier, 'absent.sock'), journal)).toEqual({
      disponible: false,
      raison: 'service de dictée absent de ce poste',
    });
  });

  test('démon qui répond pong : disponible', async () => {
    expect(await etatDictee(cheminNormal, journal)).toEqual({ disponible: true, raison: null });
  });
});

describe('transcription', () => {
  test('3 s d’audio : session neuve, trois morceaux d’une seconde, texte du final', async () => {
    recus.length = 0;
    const audio = Buffer.alloc(96_000, 1).toString('base64');
    const r = await transcrire(cheminNormal, audio, 'fr', journal);
    expect(r.etat).toBe('ok');
    expect(r.etat === 'ok' && r.texte).toBe('bonjour le monde');
    const session = recus[0]?.['session'];
    expect(recus[0]).toEqual({ op: 'ouvrir', session, langue: 'fr' });
    const morceaux = recus.filter((m) => m['op'] === 'audio');
    expect(morceaux.map((m) => Buffer.from(String(m['pcm16']), 'base64').length)).toEqual([32_000, 32_000, 32_000]);
    expect(morceaux.every((m) => m['session'] === session)).toBe(true);
    expect(recus.at(-1)).toEqual({ op: 'fermer', session });
  });

  test('audio impair ou vide : refus avant tout envoi', async () => {
    recus.length = 0;
    const r = await transcrire(cheminNormal, Buffer.alloc(3).toString('base64'), 'fr', journal);
    expect(r).toEqual({ etat: 'erreur', raison: 'audio PCM 16 bits attendu (octets pairs, non vide)' });
    expect(recus.length).toBe(0);
  });

  test('erreur du modèle côté démon : raison reprise, pas de texte', async () => {
    const r = await transcrire(cheminErreur, Buffer.alloc(4).toString('base64'), 'fr', journal);
    expect(r).toEqual({ etat: 'erreur', raison: 'modèle absent' });
  });

  test('service absent : erreur lisible, pas d’exception', async () => {
    const r = await transcrire(join(dossier, 'absent.sock'), Buffer.alloc(4).toString('base64'), 'fr', journal);
    expect(r.etat).toBe('erreur');
  });
});
