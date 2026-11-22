// Responsabilité : rejeu, par l'aiguilleur, des vérifications de outils/banc-duo/essai-api.sh (étapes 1 à 6) — un seul
// scénario ordonné entre deux propriétaires reliés par un lien duo déclaré. Le banc réel (GUI sous sway) ne tourne pas
// ici : le pont de sessions est un enregistreur qui crée la session côté propriétaire, comme le poste le ferait.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
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

test('essai du duo par l’aiguilleur : vérifications 1 à 16 de essai-api.sh, dans l’ordre', async () => {
  lierDuo('alice', 'bob');
  const alice = creerNoeud('alice');
  const bob = creerNoeud('bob');
  await relier(alice);
  await relier(bob);

  // 1. Appairage
  const code = ok(alice.duo.codeAppairage());
  expect((await bob.duo.rejoindre(alice.membre, 'AAAAAAAA')).ok).toBe(false); // 1
  ok(await bob.duo.rejoindre(alice.membre, code.code));
  await attendre(() => alice.duo.etat().appairage !== null);
  ok(alice.duo.confirmerAppairage(true));
  ok(bob.duo.confirmerAppairage(true));
  await attendre(() => alice.duo.etat().etat === 'connecte' && bob.duo.etat().etat === 'connecte');
  expect(alice.duo.etat().etat).toBe('connecte'); // 2
  expect(bob.duo.etat().etat).toBe('connecte'); // 3

  // 2. Partage en lecture, fil en direct
  const s = 'essai-1';
  envoyerPoste(alice, { kind: 'session', session: fiche(s, '/projets/essai') });
  expect(bob.registre.session(s)).toBeNull(); // 4
  partager(alice, { cible: s, genre: 'session', niveau: 'lecture' });
  await attendre(() => bob.registre.session(s) !== null);
  expect(bob.registre.session(s)?.machine).toBe('alice'); // 5
  envoyerPoste(alice, { kind: 'evenement', sessionId: s, ts: MAJ, evt: { type: 'message', texte: 'suite' } });
  await attendre(() => textes(bob, s).includes('suite'));
  expect(textes(bob, s)).toContain('suite'); // 6
  expect((await bob.duo.ecrireAPair(s, 'x', [])).ok).toBe(false); // 7

  // 3. Écrire à deux, avec accord
  partager(alice, { cible: s, genre: 'session', niveau: 'ecriture' });
  await attendre(() => bob.registre.session(s)?.duo?.niveau === 'ecriture');
  const envoi = bob.duo.ecrireAPair(s, 'message du pair', []);
  await attendre(() => alice.duo.listerDemandes().length > 0);
  const demande = alice.duo.listerDemandes()[0];
  expect(demande?.genre).toBe('message'); // 8
  alice.duo.decider(demande?.id ?? '', true);
  await envoi;
  const ecrit = expect.objectContaining({ texte: 'message du pair', auteur: 'bob' });
  expect(alice.appels.envoyer).toContainEqual(ecrit); // 9
  expect(alice.duo.journalDuo()[0]?.action).toBe('ecrire'); // 10

  // 4. Session ouverte par le pair chez le propriétaire
  alice.duo.majDroits({
    ecrireSansPermissions: 'demander',
    ouvrirSession: 'toujours',
    dossiersOuverts: [{ machine: 'tour', chemin: '/projets/essai' }],
    usagePartage: false,
    modulesPartages: [],
  });
  const dossiers = ok(await bob.duo.dossiersDuPair());
  expect(dossiers[0]?.chemin).toBe('/projets/essai'); // 11
  const ouverte = ok(
    await bob.duo.ouvrirChezPair({ machine: 'tour', chemin: '/projets/essai', message: 'prépare un plan' }),
  );
  const idOuverte = ouverte.etat === 'fait' && ouverte.session ? ouverte.session : '';
  await attendre(() => bob.registre.session(idOuverte)?.duo?.niveau === 'ecriture');
  expect(bob.registre.session(idOuverte)?.duo?.niveau).toBe('ecriture'); // 12

  // 5. Passer la main
  const main = ok(await alice.duo.avances.passerLaMain(s, 'à toi'));
  expect(main.etat).toBe('en_attente'); // 13
  const demandeMain = bob.duo.listerDemandes().find((d) => d.genre === 'passer_la_main');
  bob.duo.decider(demandeMain?.id ?? '', true, { machine: 'tour', chemin: '/projets/reprise' });
  await attendre(() => bob.appels.ouvrir.some((d) => d.projet.chemin === '/projets/reprise'));
  expect(bob.appels.ouvrir.at(-1)?.titre).toContain('reprise de alice'); // 14

  // 6. Retrait du partage, dissociation
  partager(alice, { cible: s, genre: 'session', niveau: 'lecture' });
  alice.duo.retirerPartage(s);
  await attendre(() => bob.registre.session(s) === null);
  expect(bob.registre.session(s)).toBeNull(); // 15
  alice.duo.revoquer();
  expect(alice.duo.etat().pair).toBeNull(); // 16
  await attendre(() => bob.duo.etat().etat === 'absent');
  expect(bob.registre.session(idOuverte)).toBeNull(); // 17
});
