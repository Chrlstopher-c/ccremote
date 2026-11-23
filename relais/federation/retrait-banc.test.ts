// Banc réel : un chef qui sort un membre de la charte le fait retirer de l'annuaire de l'aiguilleur.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { ajouterMembre, retirerMembre, TOUS_DROITS } from '../../commun/charte.ts';
import { exporterIdentitePublique, genererIdentite } from '../../commun/chiffrement/identite.ts';
import { attendre, creerNoeud, monterAiguilleur, type Monte, type Noeud, relier } from './banc-federation.ts';

let monte: Monte;
let noeuds: Noeud[] = [];

beforeEach(() => {
  monte = monterAiguilleur();
  noeuds = [];
});

afterEach(() => {
  for (const n of noeuds) n.federation.arreter();
  monte.serveur.stop(true);
});

test('retirer un membre de la charte le révoque dans l’annuaire de l’aiguilleur', async () => {
  const chef = creerNoeud('portable', {});
  const autre = creerNoeud('elie', {});
  noeuds.push(chef, autre);
  await relier(chef, monte, 'alice');
  const idAutre = await relier(autre, monte, 'alice');
  expect((await chef.federation.charte.creer('Maison')).ok).toBe(true);
  const identite = exporterIdentitePublique((await genererIdentite()).publique);
  const droits = { ...TOUS_DROITS };
  const membre = { id: idAutre, nom: 'elie', sorte: 'pair' as const, identite, droits, compte: null };
  expect((await chef.federation.charte.editer((c, moi, le) => ajouterMembre(c, moi, membre, le))).ok).toBe(true);
  expect(monte.annuaire.membre(idAutre)?.revoqueLe ?? null).toBeNull();
  expect((await chef.federation.charte.editer((c, moi, le) => retirerMembre(c, moi, idAutre, le))).ok).toBe(true);
  await attendre(() => (monte.annuaire.membre(idAutre)?.revoqueLe ?? null) !== null);
});
