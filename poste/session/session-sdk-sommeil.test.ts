import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { Stockage } from '../presentation/stockage.ts';
import type { Evenement } from '../../commun/session.ts';
import { attendre, journal, nouvelleSession, persistee, RequeteFausse, traduction } from './faux-sdk.ts';
import { endormirAuRepos } from './sommeil.ts';
import { type EnvironnementSdk, type FabriqueRequete, SessionSdk } from './session-sdk.ts';

const MINUTE = 60_000;
const SEUIL = 5 * MINUTE;
const PIECE = { nom: 'note.txt', mime: 'text/plain', base64: 'aGk=' };

const apres = (session: { resume: { majLe: string } }, ecart: number): number =>
  Date.parse(session.resume.majLe) + ecart;
const messagesDeChris = (recus: SDKUserMessage[]): string[] =>
  recus.flatMap((m) => (typeof m.message.content === 'string' ? [m.message.content] : []));

// Dossier des états de nuit propre à chaque test : QUART_NUIT_DIR est global au processus de test.
let dossierNuit = '';
beforeEach(() => {
  dossierNuit = mkdtempSync(join(tmpdir(), 'sommeil-nuit-'));
  mkdirSync(join(dossierNuit, 'sessions'));
  process.env['QUART_NUIT_DIR'] = dossierNuit;
});
afterEach(() => {
  rmSync(dossierNuit, { recursive: true, force: true });
});

describe('SessionSdk — mise en sommeil au repos', () => {
  test('au repos, le processus ne s’arrête qu’après le délai ; la fiche reste reprenable', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('un');
    await attendre(() => session.resume.statut === 'attente');
    expect(session.endormirSiRepos(apres(session, SEUIL - 1), SEUIL)).toBe(false);
    expect(requetes[0]?.fermee).toBe(false);
    expect(session.endormirSiRepos(apres(session, SEUIL), SEUIL)).toBe(true);
    expect(requetes[0]?.fermee).toBe(true);
    expect(session.vivante).toBe(false);
    expect(session.resume.statut).toBe('attente');
    expect(session.persistee.aReprendre).toBe(true);
    expect(session.persistee.resume.claudeSessionId).toBeTruthy();
  });

  test('le balayage ne met au repos que les sessions SDK inactives depuis le délai', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('un');
    await attendre(() => session.resume.statut === 'attente');
    endormirAuRepos([session], 5, journal, apres(session, 4 * MINUTE));
    expect(requetes[0]?.fermee).toBe(false);
    endormirAuRepos([session], 5, journal, apres(session, 5 * MINUTE));
    expect(requetes[0]?.fermee).toBe(true);
  });

  test('un tour en cours ne s’endort jamais, même après le délai', async () => {
    const { session, requetes } = nouvelleSession(async () => {
      await new Promise<never>(() => undefined);
      return [];
    });
    await session.lancer('un');
    expect(session.resume.statut).toBe('travail');
    expect(session.endormirSiRepos(apres(session, 10 * SEUIL), SEUIL)).toBe(false);
    expect(requetes[0]?.fermee).toBe(false);
  });

  test('une session en mode nuit ne s’endort pas : le réveil de nuit a besoin du processus', async () => {
    for (const id of ['claude-abc', 'quart-1']) {
      writeFileSync(join(dossierNuit, 'sessions', `${id}.json`), JSON.stringify({ since: Date.now() / 1000, open: 3 }));
    }
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('un');
    await attendre(() => session.resume.statut === 'attente' && session.resume.nuit != null);
    expect(session.endormirSiRepos(apres(session, 10 * SEUIL), SEUIL)).toBe(false);
    expect(requetes[0]?.fermee).toBe(false);
  });

  test('un message à une session endormie la relance, puis part une seule fois, sans rien perdre', async () => {
    const recus: SDKUserMessage[] = [];
    const { session, requetes, evenements } = nouvelleSession(async () => [{ type: 'result' }], {
      messagesRecus: recus,
      reprise: { statut: 'attente', aReprendre: true },
    });
    expect(requetes).toHaveLength(0);
    expect(await session.envoyer('bonjour')).toBeNull();
    await attendre(() => evenements.some((e) => e.type === 'tour_fini'));
    expect(requetes).toHaveLength(1);
    expect(requetes[0]?.options.resume).toBe('claude-abc');
    expect(messagesDeChris(recus)).toEqual(['bonjour']);
    expect(evenements.filter((e) => e.type === 'message')).toEqual([
      expect.objectContaining({ type: 'message', texte: 'bonjour' }),
    ]);
    expect(session.persistee.aReprendre).toBe(true);
  });

  test('une compaction demandée à une session endormie la réveille d’abord', async () => {
    const recus: SDKUserMessage[] = [];
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }], {
      messagesRecus: recus,
      reprise: { statut: 'attente', aReprendre: true },
    });
    expect(await session.compacter()).toBeNull();
    await attendre(() => requetes.length === 1 && messagesDeChris(recus).length === 1);
    expect(requetes[0]?.options.resume).toBe('claude-abc');
  });

  test('une session fermée par Chris ne se réveille pas pour une pièce jointe ni pour un pair', async () => {
    const env: EnvironnementSdk = {
      journal,
      sortie: { evenement: () => undefined, resume: () => undefined },
      executable: null,
      requete: (() => {
        throw new Error('aucune requête attendue');
      }) as FabriqueRequete,
      traduction,
      socket: '/run/poste.sock',
      presentation: { stockage: new Stockage(mkdtempSync(join(tmpdir(), 'sommeil-'))), racines: ['/projets'] },
    };
    const fermee = new SessionSdk(persistee(null), env);
    expect(await fermee.envoyer('voilà', [PIECE])).toBe(
      'session fermée : la reprendre avant d’y joindre des fichiers',
    );
    expect(await fermee.envoyer('voilà', [], 'Mathéo')).toBe(
      'session fermée : la reprendre avant d’écrire à deux',
    );
  });

  test('une session endormie avec une pièce jointe la reprend et envoie la pièce avec le message', async () => {
    const evenements: Evenement[] = [];
    const requetes: RequeteFausse[] = [];
    const env: EnvironnementSdk = {
      journal,
      sortie: { evenement: (_id, evt) => void evenements.push(evt), resume: () => undefined },
      executable: null,
      requete: (p) => {
        const requete = new RequeteFausse(p.prompt, p.options, async () => [{ type: 'result' }], []);
        requetes.push(requete);
        return requete;
      },
      traduction,
      socket: '/run/poste.sock',
      presentation: { stockage: new Stockage(mkdtempSync(join(tmpdir(), 'sommeil-'))), racines: ['/projets'] },
    };
    const endormie = new SessionSdk(persistee(null, null, { statut: 'attente', aReprendre: true }), env);
    expect(await endormie.envoyer('voilà', [PIECE])).toBeNull();
    await attendre(() => requetes.length === 1 && evenements.some((e) => e.type === 'tour_fini'));
    expect(evenements).toContainEqual(expect.objectContaining({ type: 'message', texte: 'voilà' }));
  });
});
