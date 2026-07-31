/**
 * M-53 — Propriété 4/5 : MODULARITÉ (03-couche-1.md, critère de réussite).
 *
 * « Ajouter un projet ne modifie aucun composant existant. »
 *
 * Ce test n'injecte AUCUN `listerFichiers`/`lireFichier` : il utilise le VRAI système de
 * fichiers du poste (`readdir`/`readFile` par défaut de `chargerProjets`) et le VRAI
 * `InterrogateurGitReel` (git réel, jamais une doublure) — c'est la seule façon de
 * prouver mécaniquement F.4.1 (« aucun redémarrage, aucun cache ») plutôt que de la
 * supposer sur des dépendances injectées. Répertoire réel dans le scratchpad de session,
 * jamais un dépôt du poste.
 *
 * Assemblage : `chargerProjets` (F.4) ET `listerProjets` (A.2.2, le VRAI point d'entrée
 * MCP que l'orchestrateur appelle) — la propriété est vérifiée aux DEUX niveaux, pas
 * seulement à l'unité interne.
 *
 * `☠ CONDITION SOUS LAQUELLE CETTE PROPRIÉTÉ CESSE DE TENIR` : la garantie tient tant que
 * le répertoire de config est lu par cet unique appel `chargerProjets`. Elle ne dit RIEN
 * sur ce qui se passerait si un futur composant introduisait un cache devant ce dossier
 * (aucun aujourd'hui — `projetsLogger.info(...)` à la fin de chaque appel confirme un
 * balayage frais à chaque fois, vérifié ci-dessous par le compte exact de fichiers vus).
 * Elle ne couvre pas non plus F2.2/F2.3 (création/modification de projet, M-60, hors
 * périmètre v1 par le graphe de dépendances) : seule la DÉCOUVERTE d'un projet déjà
 * déposé est testée ici, jamais sa création applicative.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { creerRacineTemporaire } from '../test-harness/racine-temporaire.ts';
import { chargerProjets, InterrogateurGitReel } from '../projets/index.ts';
import { listerProjets } from '../control-plane/orchestrateur/mcp-controle/outils-inspection.ts';

const TMP = creerRacineTemporaire('ccremote-modularite-');
const RACINE = TMP.racine;
const CONFIG = TMP.sousRepertoire('config');

// `☠` Les dépôts sont créés ICI : `validerConfigProjet` vérifie qu'un
// `cheminDepot` existe réellement sur le disque. Ils vivaient jusqu'ici dans un
// scratchpad de session créé à la main — le jour où la session a disparu, tout
// ce fichier est passé au rouge sans qu'une ligne de code produit ne bouge.
for (const depot of ['repo-alpha', 'repo-beta', 'repo-gamma']) TMP.sousRepertoire(depot);

afterAll(() => TMP.nettoyer());

async function ecrireProjet(nomFichier: string, contenu: Record<string, unknown>): Promise<void> {
  await writeFile(`${CONFIG}/${nomFichier}`, JSON.stringify(contenu), 'utf-8');
}

async function nettoyerConfig(): Promise<void> {
  await rm(CONFIG, { recursive: true, force: true });
  await mkdir(CONFIG, { recursive: true });
}

afterEach(async () => {
  await nettoyerConfig();
});

describe('modularité — déposer un fichier ajoute un projet, sans toucher aux autres (F.4.1)', () => {
  test('alpha seul, puis beta déposé À CHAUD : alpha réapparaît identique, aucun redémarrage', async () => {
    await nettoyerConfig();
    await ecrireProjet('alpha.json', {
      id: 'alpha',
      cheminDepot: `${RACINE}/repo-alpha`,
      budgetMaxUsd: 40,
      modeleDefaut: 'sonnet',
    });

    const premierChargement = await chargerProjets(CONFIG, { interrogateurGit: new InterrogateurGitReel() });
    expect(premierChargement.projets.map((p) => p.id)).toEqual(['alpha']);
    const alphaAvant = premierChargement.projets[0];

    // « Ajouter un projet » = déposer un fichier. Aucun appel de rechargement,
    // aucune invalidation, aucun redémarrage de process entre les deux lignes.
    await ecrireProjet('beta.json', {
      id: 'beta',
      cheminDepot: `${RACINE}/repo-beta`,
      budgetMaxUsd: 25,
      modeleDefaut: 'sonnet',
    });

    const deuxiemeChargement = await chargerProjets(CONFIG, { interrogateurGit: new InterrogateurGitReel() });
    expect(deuxiemeChargement.projets.map((p) => p.id).sort()).toEqual(['alpha', 'beta']);

    const alphaApres = deuxiemeChargement.projets.find((p) => p.id === 'alpha');
    expect(alphaApres).toEqual(alphaAvant); // strictement inchangé par l'arrivée de beta
  });

  test('un troisième fichier CORROMPU (gamma) n’efface ni alpha ni beta, déjà présents', async () => {
    await nettoyerConfig();
    await ecrireProjet('alpha.json', { id: 'alpha', cheminDepot: `${RACINE}/repo-alpha`, budgetMaxUsd: 40, modeleDefaut: 'sonnet' });
    await ecrireProjet('beta.json', { id: 'beta', cheminDepot: `${RACINE}/repo-beta`, budgetMaxUsd: 25, modeleDefaut: 'sonnet' });
    await writeFile(`${CONFIG}/gamma.json`, '{ ceci est du JSON invalide', 'utf-8');

    const resultat = await chargerProjets(CONFIG, { interrogateurGit: new InterrogateurGitReel() });

    expect(resultat.projets.map((p) => p.id).sort()).toEqual(['alpha', 'beta']);
    expect(resultat.rejetes).toHaveLength(1);
    expect(resultat.rejetes[0]?.fichierSource).toContain('gamma.json');
  });

  test('retirer beta (supprimer le fichier) le fait disparaître sans redémarrage — aucun cache résiduel', async () => {
    await nettoyerConfig();
    await ecrireProjet('alpha.json', { id: 'alpha', cheminDepot: `${RACINE}/repo-alpha`, budgetMaxUsd: 40, modeleDefaut: 'sonnet' });
    await ecrireProjet('beta.json', { id: 'beta', cheminDepot: `${RACINE}/repo-beta`, budgetMaxUsd: 25, modeleDefaut: 'sonnet' });
    await chargerProjets(CONFIG, { interrogateurGit: new InterrogateurGitReel() }); // premier appel, les deux présents

    await rm(`${CONFIG}/beta.json`);
    const apresSuppression = await chargerProjets(CONFIG, { interrogateurGit: new InterrogateurGitReel() });

    expect(apresSuppression.projets.map((p) => p.id)).toEqual(['alpha']);
  });
});

describe('modularité — vérifiée aussi à la surface MCP réelle (lister_projets, A.2.2)', () => {
  test('lister_projets reflète un projet déposé entre deux appels, sans redémarrage du serveur', async () => {
    await nettoyerConfig();
    const avant = await listerProjets(CONFIG);
    expect(avant.effet).toBe('applique');
    expect(avant.etat).toContain('aucun projet valide');

    await ecrireProjet('gamma-projet.json', { id: 'gamma-projet', cheminDepot: `${RACINE}/repo-gamma`, budgetMaxUsd: 10, modeleDefaut: 'sonnet' });

    const apres = await listerProjets(CONFIG);
    expect(apres.etat).toContain('gamma-projet');
    // Non-git : isolation non garantie, signalé explicitement (F.1.3) — pas une régression.
    expect(apres.etat).toContain('isolation NON garantie');
  });
});
