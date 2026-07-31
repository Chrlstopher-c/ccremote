/**
 * Tests du gestionnaire multi-sessions : démarrage à la demande, streaming des
 * événements vers le dépôt, réutilisation d'une session vivante, contexte lu de
 * la sentinelle, fermeture à l'archivage.
 *
 * `☠` La session est fausse mais fidèle sur les points qui comptent : `query`
 * est un flux pilotable (un seul lecteur), `envoyerOperateur` enfile sans
 * bloquer, `fermer` clôt le flux.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import type { PoigneeOrchestrateur } from './processus/index.ts';
import { GestionnaireConversations } from './gestionnaire-conversations.ts';

let repertoire: string;
let registre: Registre;

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 15));

function creerFlux(): { gen: AsyncGenerator<SDKMessage>; pousser: (m: SDKMessage) => void; fermer: () => void } {
  const tampon: SDKMessage[] = [];
  let reveiller: (() => void) | null = null;
  let ferme = false;
  const pousser = (m: SDKMessage): void => { tampon.push(m); reveiller?.(); reveiller = null; };
  const fermer = (): void => { ferme = true; reveiller?.(); reveiller = null; };
  const gen = (async function* (): AsyncGenerator<SDKMessage> {
    for (;;) {
      const suivant = tampon.shift();
      if (suivant !== undefined) { yield suivant; continue; }
      if (ferme) return;
      await new Promise<void>((r) => { reveiller = r; });
    }
  })();
  return { gen, pousser, fermer };
}

interface FausseSession {
  readonly poignee: PoigneeOrchestrateur;
  readonly envoyes: string[];
  readonly pousser: (m: SDKMessage) => void;
  ferme: boolean;
}

function fausseSession(sessionId: string): FausseSession {
  const flux = creerFlux();
  const envoyes: string[] = [];
  const etat = { ferme: false } as { ferme: boolean };
  const poignee = {
    sessionId,
    entree: { envoyerOperateur: async (t: string): Promise<void> => { envoyes.push(t); } },
    sentinelle: { resume: (): unknown => ({ derniereMesure: { ratio: 0.42 } }) },
    query: flux.gen,
    ingererMessage: (): void => {},
    fermer: (): void => { etat.ferme = true; flux.fermer(); },
  } as unknown as PoigneeOrchestrateur;
  return {
    poignee,
    envoyes,
    pousser: flux.pousser,
    get ferme(): boolean { return etat.ferme; },
    set ferme(v: boolean) { etat.ferme = v; },
  };
}

const assistant = (texte: string): SDKMessage =>
  ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: texte }] } }) as unknown as SDKMessage;
const RESULT = { type: 'result', subtype: 'success' } as unknown as SDKMessage;

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'gest-test-'));
  registre = ouvrirRegistre({ chemin: join(repertoire, 'registre.sqlite') });
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoire, { recursive: true, force: true });
});

describe('GestionnaireConversations', () => {
  test('envoyer démarre la session, persiste le message opérateur, fixe le session_id', async () => {
    const sess = fausseSession('sess-1');
    let appels = 0;
    const gest = new GestionnaireConversations(registre, async () => { appels += 1; return sess.poignee; });
    const conv = gest.creer('Mon fil');

    await gest.envoyer(conv.id, 'salut orchestrateur');
    expect(appels).toBe(1);
    expect(sess.envoyes).toEqual(['salut orchestrateur']);
    expect(registre.conversations.lire(conv.id)?.sessionId).toBe('sess-1');
    const evts = registre.conversations.evenements(conv.id);
    expect(evts[0]?.type).toBe('operateur');
    expect(evts[0]?.contenu).toBe('salut orchestrateur');
  });

  test('le streaming remonte les blocs et bascule generating à false au result', async () => {
    const sess = fausseSession('sess-1');
    const gest = new GestionnaireConversations(registre, async () => sess.poignee);
    const conv = gest.creer();
    await gest.envoyer(conv.id, 'question');
    expect(gest.detail(conv.id)?.genere).toBe(true);

    sess.pousser(assistant('Voici la réponse.'));
    sess.pousser(RESULT);
    await tick();

    const resume = gest.evenementsDepuis(conv.id, 0);
    const contenus = resume?.evenements.map((e) => `${e.type}:${e.contenu}`) ?? [];
    expect(contenus).toContain('texte:Voici la réponse.');
    expect(resume?.genere).toBe(false);
  });

  test('deux envois successifs réutilisent la MÊME session', async () => {
    const sess = fausseSession('sess-1');
    let appels = 0;
    const gest = new GestionnaireConversations(registre, async () => { appels += 1; return sess.poignee; });
    const conv = gest.creer();
    await gest.envoyer(conv.id, 'un');
    await gest.envoyer(conv.id, 'deux');
    expect(appels).toBe(1);
    // ☠ Le premier message part nu, le second porte le rappel de nommage : le fil
    // est encore anonyme et c'est le moment où la règle s'applique. Le rappel est
    // JOINT, jamais substitué — ce que Chris a tapé reste en tête du message.
    expect(sess.envoyes[0]).toBe('un');
    expect(sess.envoyes[1]?.startsWith('deux')).toBe(true);
    expect(sess.envoyes[1]).toContain('nommer_fil');
    // Et l'écran, lui, ne voit que les mots de Chris (H-66).
    const ecrits = gest.detail(conv.id)?.evenements.filter((e) => e.type === 'operateur').map((e) => e.contenu);
    expect(ecrits).toEqual(['un', 'deux']);
  });

  test('☠ un fil déjà nommé ne reçoit plus le rappel', async () => {
    // Un rappel qui survivrait au nommage pousserait au renommage à chaque tour —
    // l'exact contraire de « ce titre ne bouge plus de la session ».
    const sess = fausseSession('sess-1');
    const gest = new GestionnaireConversations(registre, async () => sess.poignee);
    const conv = gest.creer();
    await gest.envoyer(conv.id, 'un');
    gest.renommer(conv.id, 'Sujet arrêté');
    await gest.envoyer(conv.id, 'deux');
    expect(sess.envoyes[1]).toBe('deux');
  });

  test('contextePct reflète la sentinelle quand la session est active', async () => {
    const sess = fausseSession('sess-1');
    const gest = new GestionnaireConversations(registre, async () => sess.poignee);
    const conv = gest.creer();
    expect(gest.detail(conv.id)?.contextePct).toBeNull(); // pas encore de session
    await gest.envoyer(conv.id, 'x');
    expect(gest.detail(conv.id)?.contextePct).toBe(42);
  });

  test('archiver ferme la session et retire la conversation de la liste', async () => {
    const sess = fausseSession('sess-1');
    const gest = new GestionnaireConversations(registre, async () => sess.poignee);
    const conv = gest.creer();
    await gest.envoyer(conv.id, 'x');
    expect(gest.listerConversations()).toHaveLength(1);
    gest.archiver(conv.id);
    expect(sess.ferme).toBe(true);
    expect(gest.listerConversations()).toHaveLength(0);
  });

  test('envoyer sur une conversation inconnue lève, sans démarrer de session', async () => {
    const sess = fausseSession('sess-1');
    let appels = 0;
    const gest = new GestionnaireConversations(registre, async () => { appels += 1; return sess.poignee; });
    await expect(gest.envoyer('inexistant', 'x')).rejects.toThrow();
    expect(appels).toBe(0);
  });
});
