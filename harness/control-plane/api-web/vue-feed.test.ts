import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { construireFeed } from './vue-feed.ts';

let registre: Registre;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-compte1' });
  registre.lots.creer({ id: 'lot-1', intention: 'corriger le login' });
  registre.missions.creer({ id: 'm-1', lotId: 'lot-1', nom: 'auth', projet: 'alpha', compteId: 'compte1' });
});

afterEach(() => registre.fermer());

// ☠ Les entrées « permission » du fil provenaient du bus d'escalade, retiré le
// 2026-07-31 : aucune demande n'y est jamais arrivée en production. Le type
// `permission` survit au contrat d'affichage, plus rien ne l'alimente.
describe('vue-feed — le fil d’une mission', () => {
  test('☠ les transitions d’état alimentent le fil (avant : « 0 évènements » sur une équipe qui travaillait)', () => {
    registre.etats.appliquerEtatHarness('m-1', 'en_cours');
    const feed = construireFeed(registre, 'm-1');
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.some((e) => e.type === 'system' && e.text.includes('en_cours'))).toBe(true);
  });

  test('l’horodatage respecte le format HH:MM:SS du contrat', () => {
    registre.etats.appliquerEtatHarness('m-1', 'en_cours');
    for (const e of construireFeed(registre, 'm-1')) expect(e.ts).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

});

describe('vue-feed — suivre une équipe qui cherche', () => {
  test('☠ réflexions et outils entrent au fil (avant : figé sur « sdk running »)', () => {
    registre.missions.ajouterActivite('m-1', 'j’explore le dépôt', 1_000, 'reflexion');
    registre.missions.ajouterActivite('m-1', 'pattern=TODO · path=/src', 2_000, 'outil', 'Grep');
    registre.missions.ajouterActivite('m-1', 'Voici mon rapport.', 3_000, 'texte');
    const feed = construireFeed(registre, 'm-1').filter((e) => e.type === 'activity');
    expect(feed).toHaveLength(3);
    expect(feed.find((e) => e.nature === 'reflexion')).toBeDefined();
    const outil = feed.find((e) => e.nature === 'outil');
    expect(outil?.tool).toBe('Grep');
    // Un texte n'est pas décoré : c'est la réponse, pas une étape.
    expect(feed.find((e) => e.text.includes('rapport'))?.nature).toBeUndefined();
  });

  test('chaque évènement porte son instant ABSOLU, pas seulement l’heure murale', () => {
    registre.missions.ajouterActivite('m-1', 'je cherche', 1_700_000_000_000, 'reflexion');
    const feed = construireFeed(registre, 'm-1').filter((e) => e.type === 'activity');
    // Sans `at`, l'interface soustrairait des `HH:MM:SS` — faux de ~24 h dès
    // qu'un fil traverse minuit, ce qui est le cas de toute équipe du soir.
    expect(feed[0]?.at).toBe(1_700_000_000_000);
  });

  test('le fil qui traverse MINUIT reste dans l’ordre chronologique', () => {
    const avantMinuit = new Date('2026-08-03T23:58:00').getTime();
    const apresMinuit = new Date('2026-08-04T00:03:00').getTime();
    registre.missions.ajouterActivite('m-1', 'dernier acte de la veille', avantMinuit, 'texte');
    registre.missions.ajouterActivite('m-1', 'premier acte du lendemain', apresMinuit, 'texte');
    const textes = construireFeed(registre, 'm-1').filter((e) => e.type === 'activity').map((e) => e.text);
    // Le tri lexicographique sur `HH:MM:SS` remontait `00:03` AVANT `23:58` :
    // le fil se lisait à l'envers sur toute équipe lancée le soir.
    expect(textes).toEqual(['dernier acte de la veille', 'premier acte du lendemain']);
  });
});
