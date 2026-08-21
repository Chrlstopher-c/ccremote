/**
 * Tests du groupe « historique des fils » (`lister_fils`, `lire_fil`) — lecture
 * SEULE du registre (A.2.2). Cinq garanties, chacune vérifiée mécaniquement :
 *  - le filtre de plage EXCLUT réellement des fils hors plage, sans tronquer
 *    les dates/compte rendus des fils qui restent (fil ENTIER, pas la tranche) ;
 *  - un fil se lit dans l'ordre chronologique, avec son émetteur ;
 *  - le plafond dur de pagination est respecté même si le modèle en demande plus ;
 *  - un fil inexistant est un refus nommé, jamais une erreur brute ;
 *  - la base fixture est OCTET POUR OCTET identique avant et après tout appel —
 *    la preuve mécanique qu'aucun des deux outils n'écrit quoi que ce soit.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { LECTURE_FIL_MAX, lireFil, listerFils } from './outils-historique-fils.ts';

/** Base réaliste (13 chiffres) : les décalages se lient telles quelles à `normaliserInstant`. */
const BASE = 1_700_000_000_000;

let repertoire: string;
let chemin: string;
let registre: Registre;

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'hist-fils-test-'));
  chemin = join(repertoire, 'registre.sqlite');
  registre = ouvrirRegistre({ chemin });
});

afterEach(() => {
  try {
    registre.fermer();
  } catch {
    /* déjà fermé par le test */
  }
  rmSync(repertoire, { recursive: true, force: true });
});

/**
 * Quatre fils : `fil-a` et `fil-c` hors de toute plage de test, `fil-b`
 * ENTIÈREMENT dans la plage utilisée par les tests de filtre, `fil-d` À CHEVAL
 * (un événement dans la plage, un hors) — c'est ce dernier qui prouve que les
 * dates rendues portent sur le fil ENTIER, pas sur la tranche filtrée.
 */
function amorcerFixture(r: Registre): void {
  r.conversations.creer({ id: 'fil-a', titre: 'Sujet A' }, BASE);
  r.conversations.ajouterEvenement({ conversationId: 'fil-a', type: 'operateur', contenu: 'bonjour' }, BASE);
  r.conversations.ajouterEvenement({ conversationId: 'fil-a', type: 'texte', contenu: 'salut Chris' }, BASE + 100);
  r.conversations.ajouterEvenement({ conversationId: 'fil-a', type: 'texte', contenu: 'suite du fil A' }, BASE + 200);

  r.conversations.creer({ id: 'fil-b', titre: 'Sujet B' }, BASE + 5_000);
  r.conversations.ajouterEvenement({ conversationId: 'fil-b', type: 'operateur', contenu: 'question B' }, BASE + 5_000);
  r.conversations.ajouterEvenement({ conversationId: 'fil-b', type: 'texte', contenu: 'réponse B' }, BASE + 5_050);

  r.conversations.creer({ id: 'fil-c', titre: 'Sujet C' }, BASE + 9_000);
  r.conversations.ajouterEvenement({ conversationId: 'fil-c', type: 'texte', contenu: 'seul message C' }, BASE + 9_000);

  r.conversations.creer({ id: 'fil-d', titre: 'Sujet D' }, BASE + 3_000);
  r.conversations.ajouterEvenement({ conversationId: 'fil-d', type: 'operateur', contenu: 'dans la plage' }, BASE + 3_000);
  r.conversations.ajouterEvenement({ conversationId: 'fil-d', type: 'texte', contenu: 'hors de la plage' }, BASE + 8_000);
}

/** Instantané brut des deux tables, PAR UNE CONNEXION INDÉPENDANTE — jamais via le code testé. */
function snapshot(): { readonly conversations: unknown[]; readonly evenements: unknown[] } {
  const lecture = new Database(chemin, { readonly: true });
  try {
    return {
      conversations: lecture.query('SELECT * FROM conversation ORDER BY id').all(),
      evenements: lecture.query('SELECT * FROM conversation_evenement ORDER BY seq').all(),
    };
  } finally {
    lecture.close();
  }
}

describe('lister_fils', () => {
  test('la plage de dates exclut réellement les fils hors plage', () => {
    amorcerFixture(registre);
    const resultat = listerFils(registre, String(BASE + 2_000), String(BASE + 6_000));
    expect(resultat.ok).toBe(true);
    const etat = resultat.etat ?? '';
    expect(etat).toContain('fil-b');
    expect(etat).toContain('fil-d'); // au moins un événement dans la plage
    expect(etat).not.toContain('fil-a'); // tous ses événements précèdent la plage
    expect(etat).not.toContain('fil-c'); // tous ses événements suivent la plage
  });

  test('☠ un fil À CHEVAL sur la plage rend ses dates ENTIÈRES, pas celles de la tranche filtrée', () => {
    amorcerFixture(registre);
    const resultat = listerFils(registre, String(BASE + 2_000), String(BASE + 6_000));
    const etat = resultat.etat ?? '';
    const ligneD = etat.split('\n').find((l) => l.startsWith('fil-d'));
    expect(ligneD).toBeDefined();
    // 2 messages (le fil ENTIER), pas 1 (le seul dans la plage).
    expect(ligneD).toContain('2 message(s)');
  });

  test('respecte la limite demandée', () => {
    amorcerFixture(registre);
    const resultat = listerFils(registre, undefined, undefined, 1);
    expect(resultat.ok).toBe(true);
    const filsCites = (resultat.etat ?? '').match(/fil-[a-d]/g) ?? [];
    expect(new Set(filsCites).size).toBe(1);
  });

  test('aucun fil sur une base vide ⇒ applique, jamais une erreur', () => {
    const resultat = listerFils(registre);
    expect(resultat.ok).toBe(true);
    expect(resultat.effet).toBe('applique');
  });

  test('une plage inversée (fin avant début) est un refus nommé', () => {
    amorcerFixture(registre);
    const resultat = listerFils(registre, String(BASE + 6_000), String(BASE + 2_000));
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
  });

  test('☠ un fil SANS AUCUN événement apparaît, avec 0 message(s) — jamais invisible', () => {
    amorcerFixture(registre);
    registre.conversations.creer({ id: 'fil-vide', titre: 'Sujet vide' }, BASE + 4_000);
    // Plage couvrant toute la fixture, y compris la date de création de fil-vide.
    const resultat = listerFils(registre, String(BASE), String(BASE + 20_000));
    expect(resultat.ok).toBe(true);
    const etat = resultat.etat ?? '';
    const ligneVide = etat.split('\n').find((l) => l.startsWith('fil-vide'));
    expect(ligneVide).toBeDefined();
    expect(ligneVide).toContain('0 message(s)');
  });
});

describe('lire_fil', () => {
  test('les messages sont rendus dans l’ordre chronologique, avec leur émetteur', () => {
    amorcerFixture(registre);
    const resultat = lireFil(registre, 'fil-a');
    expect(resultat.ok).toBe(true);
    const etat = resultat.etat ?? '';
    const iBonjour = etat.indexOf('bonjour');
    const iSalut = etat.indexOf('salut Chris');
    const iSuite = etat.indexOf('suite du fil A');
    expect(iBonjour).toBeGreaterThan(-1);
    expect(iSalut).toBeGreaterThan(iBonjour);
    expect(iSuite).toBeGreaterThan(iSalut);
    // `operateur` ⇒ Chris, `texte` ⇒ orchestrateur — présents une fois chacun au minimum.
    expect(etat).toContain('Chris');
    expect(etat).toContain('orchestrateur');
  });

  test('le filtre de plage exclut réellement des messages hors plage', () => {
    amorcerFixture(registre);
    const resultat = lireFil(registre, 'fil-a', { depuis: String(BASE + 150) });
    expect(resultat.ok).toBe(true);
    const etat = resultat.etat ?? '';
    expect(etat).not.toContain('bonjour');
    expect(etat).not.toContain('salut Chris');
    expect(etat).toContain('suite du fil A');
  });

  test('la recherche textuelle filtre sur le contenu', () => {
    amorcerFixture(registre);
    const resultat = lireFil(registre, 'fil-a', { recherche: 'Chris' });
    expect(resultat.ok).toBe(true);
    const etat = resultat.etat ?? '';
    expect(etat).toContain('salut Chris');
    expect(etat).not.toContain('bonjour');
    expect(etat).not.toContain('suite du fil A');
  });

  test('☠ le plafond dur de pagination est respecté même si le modèle en demande davantage', () => {
    registre.conversations.creer({ id: 'fil-e', titre: 'Beaucoup de messages' }, BASE);
    const NB_EVENEMENTS = LECTURE_FIL_MAX + 10;
    for (let i = 0; i < NB_EVENEMENTS; i++) {
      registre.conversations.ajouterEvenement(
        { conversationId: 'fil-e', type: 'texte', contenu: `message ${i}` },
        BASE + i,
      );
    }
    const resultat = lireFil(registre, 'fil-e', { limite: 999_999 });
    expect(resultat.ok).toBe(true);
    const etat = resultat.etat ?? '';
    const lignesMessage = etat.split('\n').length - 1; // moins l'en-tête
    expect(lignesMessage).toBeLessThanOrEqual(LECTURE_FIL_MAX);
    expect(etat).toContain(`${NB_EVENEMENTS}`); // le total réel est dit, pas seulement la page
    expect(etat).toContain('au-delà');
  });

  test('☠ la recherche est insensible à la casse ET aux accents, dans les deux sens', () => {
    registre.conversations.creer({ id: 'fil-fr', titre: 'Sujet FR' }, BASE);
    registre.conversations.ajouterEvenement(
      { conversationId: 'fil-fr', type: 'texte', contenu: 'notre équipe travaille dessus' },
      BASE,
    );
    // Motif saisi en MAJUSCULE ACCENTUÉE : le LIKE de SQLite ne matcherait que
    // l'ASCII insensible à la casse, jamais l'accent — sans le correctif, 0 résultat.
    const resultat = lireFil(registre, 'fil-fr', { recherche: 'ÉQUIPE' });
    expect(resultat.ok).toBe(true);
    const etat = resultat.etat ?? '';
    expect(etat).toContain('notre équipe travaille dessus');
  });

  test('un fil inexistant rend un refus explicite, jamais une erreur brute', () => {
    const resultat = lireFil(registre, 'fil-totalement-inconnu');
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('fil-totalement-inconnu');
  });

  test('une plage inversée (fin avant début) est un refus nommé', () => {
    registre.conversations.creer({ id: 'fil-a', titre: 'Sujet A' }, BASE);
    const resultat = lireFil(registre, 'fil-a', { depuis: String(BASE + 6_000), jusqua: String(BASE + 2_000) });
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
  });
});

describe('☠ preuve mécanique — ne rien détruire (Chris)', () => {
  test('la base fixture est IDENTIQUE avant et après une série d’appels aux deux outils', () => {
    amorcerFixture(registre);
    const avant = snapshot();

    listerFils(registre);
    listerFils(registre, String(BASE + 2_000), String(BASE + 6_000), 1);
    lireFil(registre, 'fil-a');
    lireFil(registre, 'fil-a', { recherche: 'Chris', limite: 1, decalage: 1 });
    lireFil(registre, 'fil-inexistant'); // chemin de refus inclus — ne doit rien écrire non plus
    listerFils(registre, String(BASE + 6_000), String(BASE + 2_000)); // plage inversée, refus

    const apres = snapshot();
    expect(apres.conversations).toEqual(avant.conversations);
    expect(apres.evenements).toEqual(avant.evenements);
    expect(apres.conversations.length).toBeGreaterThan(0); // la fixture a bien existé
  });
});
