// Responsabilité : tests du duo par l'aiguilleur (étape 7) — appairage par code et empreintes, séparation entre
// propriétaires, chiffrement de bout en bout, révocation. Un vrai aiguilleur sur 127.0.0.1 (banc-duo-aiguilleur.ts).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  appairer,
  arreterTout,
  attendre,
  creerNoeud,
  demarrerAiguilleur,
  envoyerPoste,
  fiche,
  lierDuo,
  MAJ,
  ok,
  partager,
  relier,
  textes,
} from './banc-duo-aiguilleur.ts';

beforeEach(() => {
  demarrerAiguilleur();
});

afterEach(() => {
  arreterTout();
});

describe('duo par l’aiguilleur — appairage', () => {
  test('sans lien duo déclaré, aucun canal du duo ne s’ouvre', async () => {
    const alice = creerNoeud('alice');
    const bob = creerNoeud('bob');
    await relier(alice);
    await relier(bob);
    const code = ok(alice.duo.codeAppairage());
    const r = await bob.duo.rejoindre(code.membre ?? '', code.code);
    expect(r.ok).toBe(false);
    expect(bob.duo.etat().etat).toBe('absent');
    expect(alice.duo.etat().appairage).toBeNull();
  });

  test('avec lien duo : empreintes croisées identiques, accord des deux côtés, lien ouvert', async () => {
    lierDuo('alice', 'bob');
    const alice = creerNoeud('alice');
    const bob = creerNoeud('bob');
    await relier(alice);
    await relier(bob);
    const code = ok(alice.duo.codeAppairage());
    expect(code.membre).toBe(alice.membre);
    ok(await bob.duo.rejoindre(alice.membre, code.code));
    await attendre(() => alice.duo.etat().appairage !== null);
    const vueAlice = alice.duo.etat().appairage?.empreintes;
    const vueBob = bob.duo.etat().appairage?.empreintes;
    expect(vueBob?.locale).toBe(vueAlice?.distante);
    expect(vueAlice?.locale).toBe(vueBob?.distante);
    expect(vueBob?.locale).not.toBe(vueBob?.distante);
    expect(bob.duo.etat().transport).toBeNull();
    ok(alice.duo.confirmerAppairage(true));
    ok(bob.duo.confirmerAppairage(true));
    await attendre(() => alice.duo.etat().etat === 'connecte' && bob.duo.etat().etat === 'connecte');
    expect(alice.duo.etat().transport).toBe('aiguilleur');
    expect(bob.duo.etat().transport).toBe('aiguilleur');
    expect(bob.duo.etat().pair?.utilisateur).toBe('alice');
    expect(alice.duo.etat().appairage).toBeNull();
  });

  test('un faux code est refusé et ne brûle pas le vrai', async () => {
    lierDuo('alice', 'bob');
    const alice = creerNoeud('alice');
    const bob = creerNoeud('bob');
    await relier(alice);
    await relier(bob);
    const code = ok(alice.duo.codeAppairage());
    const faux = await bob.duo.rejoindre(alice.membre, code.code === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA');
    expect(faux.ok).toBe(false);
    expect(alice.duo.etat().appairage).toBeNull();
    ok(await bob.duo.rejoindre(alice.membre, code.code));
    expect(alice.duo.etat().appairage).not.toBeNull();
  });

  test('un refus sur les empreintes annule l’appairage des deux côtés', async () => {
    lierDuo('alice', 'bob');
    const alice = creerNoeud('alice');
    const bob = creerNoeud('bob');
    await relier(alice);
    await relier(bob);
    const code = ok(alice.duo.codeAppairage());
    ok(await bob.duo.rejoindre(alice.membre, code.code));
    await attendre(() => alice.duo.etat().appairage !== null);
    ok(alice.duo.confirmerAppairage(false));
    await attendre(() => bob.duo.etat().appairage === null);
    expect(alice.duo.etat().appairage).toBeNull();
    expect(alice.duo.etat().transport).toBeNull();
    expect(bob.duo.etat().transport).toBeNull();
    expect(bob.duo.confirmerAppairage(true).ok).toBe(false);
  });

  test('un nœud qui n’a pas de code vivant ne peut pas ouvrir d’appairage vers la tour', async () => {
    lierDuo('alice', 'bob');
    const tour = creerNoeud('alice');
    const bob = creerNoeud('bob');
    await relier(tour);
    await relier(bob);
    const r = await bob.duo.rejoindre(tour.membre, 'ABCDEFGH');
    expect(r.ok).toBe(false);
    expect(tour.duo.etat().appairage).toBeNull();
    expect(bob.duo.etat().etat).toBe('absent');
  });

  test('une seconde paire est refusée tant que le duo est établi', async () => {
    lierDuo('alice', 'bob');
    const alice = creerNoeud('alice');
    const bob = creerNoeud('bob');
    await relier(alice);
    await relier(bob);
    await appairer(alice, bob);
    expect(alice.duo.codeAppairage().ok).toBe(false);
  });
});

describe('duo par l’aiguilleur — séparation et échanges', () => {
  test('Bob ne voit que les sessions partagées, jamais la fédération de Alice', async () => {
    lierDuo('alice', 'bob');
    const alice = creerNoeud('alice');
    const bob = creerNoeud('bob');
    await relier(alice);
    await relier(bob);
    await appairer(alice, bob);
    envoyerPoste(alice, { kind: 'session', session: fiche('s1', '/p1') });
    envoyerPoste(alice, { kind: 'session', session: fiche('s2', '/p2') });
    partager(alice, { cible: 's2', genre: 'session', niveau: 'lecture' });
    await attendre(() => bob.registre.session('s2') !== null);
    expect(bob.registre.session('s1')).toBeNull();
    envoyerPoste(alice, { kind: 'evenement', sessionId: 's2', ts: MAJ, evt: { type: 'message', texte: 'bonjour' } });
    envoyerPoste(alice, { kind: 'evenement', sessionId: 's1', ts: MAJ, evt: { type: 'message', texte: 'secret' } });
    await attendre(() => textes(bob, 's2').includes('bonjour'));
    expect(textes(bob, 's1')).toEqual([]);
    expect((await bob.federation.etat()).noeuds).toEqual([]);
    expect(bob.federation.distantes.sessions()).toEqual([]);
  });

  test('l’aiguilleur ne voit que des trames chiffrées une fois le lien ouvert', async () => {
    lierDuo('alice', 'bob');
    const alice = creerNoeud('alice');
    const bob = creerNoeud('bob');
    await relier(alice);
    await relier(bob);
    await appairer(alice, bob);
    envoyerPoste(alice, { kind: 'session', session: fiche('s2', '/p2') });
    partager(alice, { cible: 's2', genre: 'session', niveau: 'lecture' });
    await attendre(() => bob.registre.session('s2') !== null);
    const evt = { type: 'message', texte: 'contenu-cache' };
    envoyerPoste(alice, { kind: 'evenement', sessionId: 's2', ts: MAJ, evt });
    await attendre(() => textes(bob, 's2').includes('contenu-cache'));
    const trafic = [...alice.charges, ...bob.charges];
    expect(trafic.some((c) => c.includes('contenu-cache') || c.includes('Titre s2'))).toBe(false);
    const chiffres = trafic.filter((c) => (JSON.parse(c) as { t?: string }).t === 'chiffre');
    expect(chiffres.length).toBeGreaterThan(0);
  });

  test('révocation par un côté : le pair perd la paire et les sessions reçues', async () => {
    lierDuo('alice', 'bob');
    const alice = creerNoeud('alice');
    const bob = creerNoeud('bob');
    await relier(alice);
    await relier(bob);
    await appairer(alice, bob);
    envoyerPoste(alice, { kind: 'session', session: fiche('s2', '/p2') });
    partager(alice, { cible: 's2', genre: 'session', niveau: 'lecture' });
    await attendre(() => bob.registre.session('s2') !== null);
    alice.duo.revoquer();
    await attendre(() => bob.duo.etat().etat === 'absent');
    expect(bob.duo.etat().transport).toBeNull();
    expect(bob.registre.session('s2')).toBeNull();
    expect(alice.duo.etat().etat).toBe('absent');
  });
});
