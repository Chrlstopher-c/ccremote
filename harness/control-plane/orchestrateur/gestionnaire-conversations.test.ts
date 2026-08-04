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
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import type { PoigneeOrchestrateur } from './processus/index.ts';
import { GestionnaireConversations } from './gestionnaire-conversations.ts';
import { ErreurPieceJointe } from '../pieces-jointes/index.ts';

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

/**
 * `☠` Ces tests partent du chemin RÉELLEMENT emprunté par un message de
 * l'interface — `envoyer`, jusqu'au texte reçu par le SDK. C'est la leçon du
 * 03/08 : une règle écrite dans un objet qui n'alimente pas le systemPrompt
 * paraît livrée et ne l'est pas. Ici, ce qui compte n'est pas que le fichier
 * existe, c'est que le CHEMIN arrive dans ce que le modèle lit.
 */
describe('GestionnaireConversations — pièces jointes (migration 24)', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x2a]).toString('base64');
  const piece = (nom = 'capture.png'): { nom: string; type: string; donneesBase64: string } =>
    ({ nom, type: 'image/png', donneesBase64: PNG });

  function gestionnaireAvecPieces(sess: FausseSession): { gest: GestionnaireConversations; racine: string } {
    const racine = join(repertoire, 'pieces');
    const gest = new GestionnaireConversations(
      registre,
      async () => sess.poignee,
      undefined,
      undefined,
      racine,
    );
    return { gest, racine };
  }

  test('le CHEMIN de la pièce et la consigne de lecture arrivent au SDK', async () => {
    const sess = fausseSession('sess-1');
    const { gest, racine } = gestionnaireAvecPieces(sess);
    const conv = gest.creer('Fil');
    await gest.envoyer(conv.id, 'regarde ça', {}, [piece()]);

    const envoye = sess.envoyes[0] ?? '';
    expect(envoye).toContain('regarde ça');
    expect(envoye).toContain(racine);
    expect(envoye).toContain('capture.png');
    // Sans la consigne, un chemin dans un message se lit comme une référence
    // documentaire — et la pièce reste invisible au modèle.
    expect(envoye).toContain('Read');
  });

  test('le fichier est réellement posé sur le disque', async () => {
    const sess = fausseSession('sess-1');
    const { gest, racine } = gestionnaireAvecPieces(sess);
    const conv = gest.creer();
    await gest.envoyer(conv.id, 'x', {}, [piece()]);

    const evt = registre.conversations.evenements(conv.id)[0];
    const fichier = evt?.pieces[0]?.fichier ?? '';
    expect(fichier).not.toBe('');
    expect(existsSync(join(racine, conv.id, fichier))).toBe(true);
  });

  test('le registre garde le texte EXACT de l’opérateur, jamais le bloc des chemins (H-66)', async () => {
    const sess = fausseSession('sess-1');
    const { gest } = gestionnaireAvecPieces(sess);
    const conv = gest.creer();
    await gest.envoyer(conv.id, 'regarde ça', {}, [piece()]);

    const evt = registre.conversations.evenements(conv.id)[0];
    expect(evt?.contenu).toBe('regarde ça');
    expect(evt?.pieces).toHaveLength(1);
    expect(evt?.pieces[0]?.nom).toBe('capture.png');
    expect(evt?.pieces[0]?.type).toBe('image/png');
  });

  test('un message SANS texte mais AVEC une capture passe', async () => {
    const sess = fausseSession('sess-1');
    const { gest } = gestionnaireAvecPieces(sess);
    const conv = gest.creer();
    await gest.envoyer(conv.id, '', {}, [piece()]);
    expect(sess.envoyes[0]).toContain('capture.png');
  });

  test('un message vide SANS pièce reste refusé', async () => {
    const sess = fausseSession('sess-1');
    const { gest } = gestionnaireAvecPieces(sess);
    const conv = gest.creer();
    await expect(gest.envoyer(conv.id, '   ')).rejects.toThrow(RangeError);
  });

  test('une pièce refusée n’écrit NI fichier NI événement, et ne démarre pas la session', async () => {
    const sess = fausseSession('sess-1');
    let appels = 0;
    const racine = join(repertoire, 'pieces');
    const gest = new GestionnaireConversations(
      registre,
      async () => { appels += 1; return sess.poignee; },
      undefined,
      undefined,
      racine,
    );
    const conv = gest.creer();
    await expect(
      gest.envoyer(conv.id, 'tiens', {}, [{ nom: 'x.exe', type: 'application/x-msdownload', donneesBase64: PNG }]),
    ).rejects.toThrow(ErreurPieceJointe);
    expect(appels).toBe(0);
    expect(registre.conversations.evenements(conv.id)).toHaveLength(0);
    expect(existsSync(racine)).toBe(false);
  });

  test('sans racine configurée, une pièce est REFUSÉE — jamais acceptée puis jetée', async () => {
    const sess = fausseSession('sess-1');
    const gest = new GestionnaireConversations(registre, async () => sess.poignee);
    const conv = gest.creer();
    await expect(gest.envoyer(conv.id, 'tiens', {}, [piece()])).rejects.toThrow(/racine de stockage/);
    expect(registre.conversations.evenements(conv.id)).toHaveLength(0);
  });

  test('un message sans pièce ne porte aucun bloc parasite', async () => {
    const sess = fausseSession('sess-1');
    const { gest } = gestionnaireAvecPieces(sess);
    const conv = gest.creer();
    await gest.envoyer(conv.id, 'juste du texte');
    expect(sess.envoyes[0]).toBe('juste du texte');
    expect(registre.conversations.evenements(conv.id)[0]?.pieces).toEqual([]);
  });
});
