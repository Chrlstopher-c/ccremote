import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import type { InterrogateurGit } from '../../../projets/index.ts';
import { etatEquipe, historiqueEquipe, listerEquipes, listerProjets, rapportEquipe } from './outils-inspection.ts';

const GIT_FACTICE_NON_GIT: InterrogateurGit = {
  estDepotGit: async () => false,
  existeBranche: async () => false,
  aTravailNonCommite: async () => false,
};

let registre: Registre;
let repertoireProjets: string;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-compte1' });
  registre.lots.creer({ id: 'lot-1', intention: 'corriger le login' });
  repertoireProjets = mkdtempSync(join(tmpdir(), 'mcp-controle-projets-'));
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoireProjets, { recursive: true, force: true });
});

describe('outils-inspection (A.2.2, groupe lecture seule)', () => {
  test('lister_equipes : aucune équipe active', () => {
    const resultat = listerEquipes(registre);
    expect(resultat.ok).toBe(true);
    expect(resultat.effet).toBe('applique');
    expect(resultat.etat).toBe('aucune équipe active');
  });

  test('lister_equipes : résumé sans flux brut (H-45)', () => {
    registre.missions.creer({ id: 'm-1', lotId: 'lot-1', nom: 'refaire auth', projet: 'alpha', compteId: 'compte1' });
    const resultat = listerEquipes(registre);
    expect(resultat.etat).toContain('m-1');
    expect(resultat.etat).toContain('harness=planifiee');
  });

  test('etat_equipe : mission introuvable ⇒ refus explicite, pas d’exception', () => {
    const resultat = etatEquipe(registre, 'inconnue');
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('aucune équipe');
  });

  test('☠ lister_equipes montre aussi les équipes TERMINÉES (23/07)', () => {
    registre.missions.creer({ id: 'm-viv', lotId: 'lot-1', nom: 'en cours', projet: 'alpha', compteId: 'compte1' });
    registre.missions.creer({ id: 'm-fin', lotId: 'lot-1', nom: 'finie', projet: 'beta', compteId: 'compte1' });
    registre.etats.appliquerEtatHarness('m-fin', 'terminee');
    const resultat = listerEquipes(registre);
    expect(resultat.etat).toContain('m-viv');
    // Sans ce rendu, l'orchestrateur répondait « introuvable » sur une équipe
    // que l'opérateur venait de voir se terminer.
    expect(resultat.etat).toContain('m-fin');
    expect(resultat.etat).toContain('terminées récentes');
  });

  test('☠ etat_equipe accepte le NOM, pas seulement l’identifiant (23/07)', () => {
    registre.missions.creer({ id: 'm-3', lotId: 'lot-1', nom: 'refonte panier', projet: 'vela', compteId: 'compte1' });
    expect(etatEquipe(registre, 'refonte panier').ok).toBe(true);
    expect(etatEquipe(registre, 'vela').ok).toBe(true);
    // Fragment : ce que l'opérateur retient réellement d'un nom.
    expect(etatEquipe(registre, 'panier').ok).toBe(true);
  });

  test('etat_equipe : désignation ambiguë ⇒ refus qui liste les candidats, jamais un choix au hasard', () => {
    registre.missions.creer({ id: 'm-a', lotId: 'lot-1', nom: 'refonte panier', projet: 'vela', compteId: 'compte1' });
    registre.missions.creer({ id: 'm-b', lotId: 'lot-1', nom: 'refonte compte', projet: 'lattice', compteId: 'compte1' });
    const resultat = etatEquipe(registre, 'refonte');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('ambiguë');
    expect(resultat.raison).toContain('m-a');
    expect(resultat.raison).toContain('m-b');
  });

  test('etat_equipe : détail budget/contexte/capacités', () => {
    registre.missions.creer({
      id: 'm-2',
      lotId: 'lot-1',
      nom: 'refaire auth',
      projet: 'alpha',
      compteId: 'compte1',
      budgetMaxUsd: 100,
    });
    const resultat = etatEquipe(registre, 'm-2');
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('budget=0/100');
    expect(resultat.etat).toContain('capacités surveillées toutes présentes');
  });

  test('lister_projets : répertoire vide ⇒ aucun projet valide', async () => {
    const resultat = await listerProjets(repertoireProjets, GIT_FACTICE_NON_GIT);
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toBe('aucun projet valide');
  });

  test('lister_projets : fichier invalide rejeté, jamais une exception', async () => {
    writeFileSync(join(repertoireProjets, 'casse.json'), JSON.stringify({ id: 'x' }));
    const resultat = await listerProjets(repertoireProjets, GIT_FACTICE_NON_GIT);
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('rejetés');
  });

  test('☠ lister_projets : répertoire illisible ⇒ ok:false, jamais de rejet vers l’appelant', async () => {
    const inexistant = join(repertoireProjets, 'nexiste-pas');
    const resultat = await listerProjets(inexistant, GIT_FACTICE_NON_GIT);
    // chargerProjets absorbe déjà le répertoire illisible en interne (retourne []) —
    // le contrat de ce module reste donc ok:true, aucune exception ne remonte.
    expect(resultat.ok).toBe(true);
  });

  test('historique_equipe : aucune transition connue', () => {
    registre.missions.creer({ id: 'm-3', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    const resultat = historiqueEquipe(registre, 'm-3');
    expect(resultat.etat).toBe('aucune transition connue');
  });

  test('historique_equipe : résume origine/motif d’une transition', () => {
    registre.missions.creer({ id: 'm-4', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    registre.etats.appliquerEtatHarness('m-4', 'en_cours', { motif: 'dispatch initial' });
    const resultat = historiqueEquipe(registre, 'm-4');
    expect(resultat.etat).toContain('[harness] planifiee → en_cours (dispatch initial)');
  });

});

describe('rapport_equipe — ce que l’équipe a écrit', () => {
  test('☠ rend les textes produits, pas seulement les compteurs (23/07)', () => {
    registre.missions.creer({ id: 'm-r', lotId: 'lot-1', nom: 'vela', projet: 'vela', compteId: 'compte1' });
    registre.missions.ajouterActivite('m-r', 'Premier constat.', 1_000);
    registre.missions.ajouterActivite('m-r', 'Rapport final : tout compile.', 2_000);
    const resultat = rapportEquipe(registre, 'vela');
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('Rapport final');
  });

  test('aucune activité rapatriée ⇒ le dit, sans prétendre que l’équipe n’a rien fait', () => {
    registre.missions.creer({ id: 'm-v', lotId: 'lot-1', nom: 'vide', projet: 'lattice', compteId: 'compte1' });
    const resultat = rapportEquipe(registre, 'lattice');
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('aucun texte produit');
  });

  test('☠ rend le dernier texte ENTIER, jamais tronqué (décision opérateur 23/07)', () => {
    registre.missions.creer({ id: 'm-n', lotId: 'lot-1', nom: 'long', projet: 'aegis', compteId: 'compte1' });
    const synthese = `SYNTHÈSE\n${'détail '.repeat(2_000)}FIN`;
    registre.missions.ajouterActivite('m-n', synthese, 9_000);
    const resultat = rapportEquipe(registre, 'aegis');
    // Une synthèse coupée en son milieu ne vaut rien : le début ET la fin doivent survivre.
    expect(resultat.etat).toContain('SYNTHÈSE');
    expect(resultat.etat).toContain('FIN');
    expect((resultat.etat ?? '').length).toBe(synthese.length);
  });

  test('☠ réflexions et appels d’outils ne sont JAMAIS pris pour le rapport', () => {
    registre.missions.creer({ id: 'm-t', lotId: 'lot-1', nom: 'mixte', projet: 'flux', compteId: 'compte1' });
    registre.missions.ajouterActivite('m-t', 'la vraie synthèse', 1_000, 'texte');
    registre.missions.ajouterActivite('m-t', 'je me demande si…', 2_000, 'reflexion');
    registre.missions.ajouterActivite('m-t', 'pattern=TODO', 3_000, 'outil', 'Grep');
    // Le dernier ÉVÉNEMENT est un outil ; le dernier TEXTE reste la synthèse.
    expect(rapportEquipe(registre, 'flux').etat).toBe('la vraie synthèse');
  });
});
