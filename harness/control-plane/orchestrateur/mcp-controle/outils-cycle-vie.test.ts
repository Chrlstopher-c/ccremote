import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import {
  arreterEquipe,
  envoyerAEquipe,
  interrompreEquipe,
  proposerCreationEquipe,
  relancerEquipe,
  retirerMandat,
} from './outils-cycle-vie.ts';
import { definirBudget } from './outils-budget.ts';
import type {
  ArreteurMission,
  ConfigPlafondParc,
  DefinisseurBudget,
  EmetteurEquipe,
  EnregistreurProposition,
  LecteurUtilisationParc,
  RelanceurMission,
} from './types.ts';
import type { RelevePourPlafond } from '../../../budgets/index.ts';

let registre: Registre;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-compte1' });
  registre.lots.creer({ id: 'lot-1', intention: 'corriger le login' });
  // Carburant consulté par défaut : ce fichier teste d'autres gardes que la
  // garde 2, qui a son propre `describe` avec ses propres réglages explicites.
  registre.observationParc.enregistrerConsultationCarburant(Date.now());
});

afterEach(() => {
  registre.fermer();
});

/** Émetteur qui accepte tout sans rien dire de plus — le cas nominal. */
const EMETTEUR_MUET: EmetteurEquipe = {
  envoyer: async () => ({ detail: '' }),
  interrompre: async () => {},
};

/** Lecteur de test : aucun compte connu ⇒ plafond de parc non contraignant (défaut). */
const LECTEUR_PERMISSIF: LecteurUtilisationParc = { comptesConnus: () => [], releves: () => [] };
const PLAFOND_DESACTIVE: ConfigPlafondParc = {};

function fabriquerLecteur(parCompte: Record<string, readonly RelevePourPlafond[]>): LecteurUtilisationParc {
  return {
    comptesConnus: () => Object.keys(parCompte),
    releves: (compteId) => parCompte[compteId] ?? [],
  };
}

describe('proposerCreationEquipe (H-61 — FAIT AUTORITÉ, ne crée jamais rien)', () => {
  test("retourne 'differe' avec une proposition de mandat, jamais 'applique'", async () => {
    const resultat = await proposerCreationEquipe(
      'alpha',
      'refaire l’auth',
      'tests verts : `bun test` sans échec',
      'src/auth/**',
      'ecriture',
      registre,
      LECTEUR_PERMISSIF,
      PLAFOND_DESACTIVE,
      { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) },
    );
    expect(resultat.effet).toBe('differe');
    expect(resultat.ref).toBeDefined();
    expect(resultat.etat).toContain('refaire l’auth');
  });

  test('☠ ne touche à AUCUN registre — aucune mission créée', async () => {
    await proposerCreationEquipe('alpha', 'x', 'y', 'z', 'ecriture', registre, LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
    expect(registre.missions.listerActives().length).toBe(0);
  });
});

describe('proposerCreationEquipe × plafond de parc (G.1.3 — câblage réel, M-53 corrigé)', () => {
  test('seuil bas dépassé sur le seul compte connu ⇒ refus, jamais differe', async () => {
    const lecteur = fabriquerLecteur({
      compte1: [{ compteId: 'compte1', typeFenetre: 'five_hour', utilisation: 90, statut: 'allowed' }],
    });
    const resultat = await proposerCreationEquipe('alpha', 'x', null, 'src/**', 'ecriture', registre, lecteur, { seuilUtilisationPct: 10 }, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('compte1');
    expect(resultat.raison).toContain('five_hour');
  });

  test('seuil haut, sous le seuil ⇒ autorisé, differe', async () => {
    const lecteur = fabriquerLecteur({
      compte1: [{ compteId: 'compte1', typeFenetre: 'five_hour', utilisation: 20, statut: 'allowed' }],
    });
    const resultat = await proposerCreationEquipe('alpha', 'x', null, 'src/**', 'ecriture', registre, lecteur, { seuilUtilisationPct: 85 }, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
    expect(resultat.effet).toBe('differe');
  });

  test('un compte saturé mais un second disponible ⇒ autorisé (au moins un compte viable)', async () => {
    const lecteur = fabriquerLecteur({
      compte1: [{ compteId: 'compte1', typeFenetre: 'five_hour', utilisation: 99, statut: 'allowed' }],
      compte2: [{ compteId: 'compte2', typeFenetre: 'five_hour', utilisation: 5, statut: 'allowed' }],
    });
    const resultat = await proposerCreationEquipe('alpha', 'x', null, 'src/**', 'ecriture', registre, lecteur, { seuilUtilisationPct: 85 }, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
    expect(resultat.effet).toBe('differe');
  });

  test('tous les comptes saturés ⇒ refus, motif lisible par compte', async () => {
    const lecteur = fabriquerLecteur({
      compte1: [{ compteId: 'compte1', typeFenetre: 'five_hour', utilisation: 90, statut: 'allowed' }],
      compte2: [{ compteId: 'compte2', typeFenetre: 'seven_day', utilisation: 95, statut: 'allowed' }],
    });
    const resultat = await proposerCreationEquipe('alpha', 'x', null, 'src/**', 'ecriture', registre, lecteur, { seuilUtilisationPct: 85 }, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('compte1');
    expect(resultat.raison).toContain('compte2');
  });

  test('aucun compte connu ⇒ rien à borner, autorisé', async () => {
    const resultat = await proposerCreationEquipe('alpha', 'x', null, 'src/**', 'ecriture', registre, LECTEUR_PERMISSIF, { seuilUtilisationPct: 1 }, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
    expect(resultat.effet).toBe('differe');
  });

  test('☠ un port qui lève une exception ne bloque jamais l’outil ⇒ refus propre, pas de throw', async () => {
    const lecteur: LecteurUtilisationParc = {
      comptesConnus: () => {
        throw new Error('port hors service');
      },
      releves: () => [],
    };
    const resultat = await proposerCreationEquipe('alpha', 'x', null, 'src/**', 'ecriture', registre, lecteur, PLAFOND_DESACTIVE, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('port hors service');
  });
});

/** Équipe vivante en registre — le cas normal de tout ce bloc. */
function equipeVivante(id: string, nom = 'auth', projet = 'alpha'): void {
  registre.missions.creer({ id, lotId: 'lot-1', nom, projet, compteId: 'compte1', sessionId: `sess-${id}` });
  registre.etats.appliquerEtatHarness(id, 'en_cours', { motif: 'test' });
}

describe('envoyerAEquipe (H-67 — mise en file, jamais une interruption)', () => {
  test('équipe introuvable ⇒ refus explicite', async () => {
    const resultat = await envoyerAEquipe(EMETTEUR_MUET, registre, 'inconnue', 'salut');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('aucune équipe');
  });

  test("succès ⇒ 'accepte', jamais 'applique' (l’équipe n’a pas encore lu le message)", async () => {
    equipeVivante('m-1');
    let recu: string | undefined;
    const resultat = await envoyerAEquipe(
      {
        envoyer: async (_id, t) => {
          recu = t;
          return { detail: 'instruction transmise' };
        },
        interrompre: async () => {},
      },
      registre,
      'm-1',
      'fais X',
    );
    expect(resultat.effet).toBe('accepte');
    expect(recu).toContain('fais X');
  });

  test('le message porte le préfixe structurel émetteur:orchestrateur (H-66)', async () => {
    equipeVivante('m-1');
    let recu: string | undefined;
    await envoyerAEquipe(
      {
        envoyer: async (_id, t) => {
          recu = t;
          return { detail: '' };
        },
        interrompre: async () => {},
      },
      registre,
      'm-1',
      'fais X',
    );
    expect(recu).toContain('[émetteur:orchestrateur]');
  });

  test('☠ une équipe `idle` reste JOIGNABLE — c’est le cas d’usage, pas une erreur', async () => {
    equipeVivante('m-idle');
    registre.etats.appliquerEtatSdk('m-idle', 'idle');
    const resultat = await envoyerAEquipe(EMETTEUR_MUET, registre, 'm-idle', 'continue');
    expect(resultat.ok).toBe(true);
  });

  test('☠ équipe terminée ⇒ refus qui NOMME la vraie cause (pas « introuvable »)', async () => {
    registre.missions.creer({ id: 'm-fin', lotId: 'lot-1', nom: 'finie', projet: 'gamma', compteId: 'compte1' });
    registre.etats.appliquerEtatHarness('m-fin', 'terminee', { motif: 'test' });
    const resultat = await envoyerAEquipe(EMETTEUR_MUET, registre, 'm-fin', 'salut');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('terminee');
  });

  test('désignation libre (nom du projet) acceptée, comme pour suivre_equipe', async () => {
    equipeVivante('m-2', 'refonte', 'beta');
    const resultat = await envoyerAEquipe(EMETTEUR_MUET, registre, 'beta', 'continue');
    expect(resultat.ok).toBe(true);
    expect(resultat.ref).toBe('m-2');
  });

  test('le détail rendu par la machine est rapporté tel quel (message RETENU en pause)', async () => {
    equipeVivante('m-3');
    const resultat = await envoyerAEquipe(
      { envoyer: async () => ({ detail: 'instruction retenue — mission en pause' }), interrompre: async () => {} },
      registre,
      'm-3',
      'x',
    );
    expect(resultat.etat).toContain('retenue');
  });

  test('message vide ⇒ refus, rien ne part', async () => {
    equipeVivante('m-4');
    const resultat = await envoyerAEquipe(EMETTEUR_MUET, registre, 'm-4', '   ');
    expect(resultat.ok).toBe(false);
  });

  test('☠ (a) un port qui ne répond jamais ⇒ refus rapide, pas de blocage', async () => {
    equipeVivante('m-1');
    const debut = Date.now();
    const resultat = await envoyerAEquipe(
      { envoyer: () => new Promise(() => {}), interrompre: async () => {} },
      registre,
      'm-1',
      'x',
      30,
    );
    expect(Date.now() - debut).toBeLessThan(500);
    expect(resultat.ok).toBe(false);
  });
});

describe('interrompreEquipe (B.4)', () => {
  test('résolution du port ⇒ applique (la résolution EST la confirmation)', async () => {
    equipeVivante('m-1');
    const resultat = await interrompreEquipe(EMETTEUR_MUET, registre, 'm-1');
    expect(resultat.effet).toBe('applique');
  });

  test('équipe déjà terminée ⇒ refus explicite, aucun ordre ne part', async () => {
    registre.missions.creer({ id: 'm-fin', lotId: 'lot-1', nom: 'finie', projet: 'gamma', compteId: 'compte1' });
    registre.etats.appliquerEtatHarness('m-fin', 'terminee', { motif: 'test' });
    let appele = false;
    const resultat = await interrompreEquipe(
      {
        envoyer: async () => ({ detail: '' }),
        interrompre: async () => {
          appele = true;
        },
      },
      registre,
      'm-fin',
    );
    expect(resultat.ok).toBe(false);
    expect(appele).toBe(false);
  });

  test('☠ (a) port muet ⇒ refus rapide, jamais un blocage du tour', async () => {
    equipeVivante('m-1');
    const debut = Date.now();
    const resultat = await interrompreEquipe(
      { envoyer: async () => ({ detail: '' }), interrompre: () => new Promise(() => {}) },
      registre,
      'm-1',
      30,
    );
    expect(Date.now() - debut).toBeLessThan(500);
    expect(resultat.ok).toBe(false);
  });
});

describe('arreterEquipe (fin de vie)', () => {
  test('mission introuvable ⇒ refus', async () => {
    const arreteur: ArreteurMission = { arreter: async () => {} };
    const resultat = await arreterEquipe(arreteur, registre, 'inconnue');
    expect(resultat.ok).toBe(false);
  });

  test("état harness écrit immédiatement, effet 'accepte' (jamais 'applique')", async () => {
    registre.missions.creer({ id: 'm-5', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    const arreteur: ArreteurMission = { arreter: async () => {} };
    const resultat = await arreterEquipe(arreteur, registre, 'm-5');
    // `☠` La machine a CONFIRMÉ : le projet est libre, et l'orchestrateur doit
    // pouvoir le savoir pour redispatcher sans attendre au hasard.
    expect(resultat.effet).toBe('applique');
    expect(resultat.etat).toContain('libre');
    expect(registre.missions.lire('m-5')?.etatHarness).toBe('annulee');
  });

  test('☠ (a) port de teardown qui ne répond jamais ⇒ retour rapide, registre déjà à jour', async () => {
    registre.missions.creer({ id: 'm-6', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    const arreteur: ArreteurMission = { arreter: () => new Promise(() => {}) };
    const debut = Date.now();
    const resultat = await arreterEquipe(arreteur, registre, 'm-6', 30);
    expect(Date.now() - debut).toBeLessThan(500);
    expect(resultat.effet).toBe('accepte');
    expect(resultat.etat).toContain('non reçue à temps');
    expect(registre.missions.lire('m-6')?.etatHarness).toBe('annulee');
  });
});

/**
 * `☠ ARRÊTER N'EST PAS ANNULER` (03/08). La notification de fin d'équipe ORDONNE
 * d'appeler `arreter_equipe` pour libérer le projet (H-56) : toute équipe qui
 * rendait son rapport finissait donc marquée « annulée ». 43 missions au registre
 * ce jour-là, dont l'immense majorité avait réussi — et c'est cet historique-là que
 * l'orchestrateur relit avant de décider de la suite.
 */
describe('arreterEquipe × état terminal déjà acquis', () => {
  test('une équipe TERMINÉE garde son état — l’arrêt ne fait que libérer le projet', async () => {
    registre.missions.creer({ id: 'm-fin', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    registre.etats.appliquerEtatHarness('m-fin', 'en_cours', {});
    registre.etats.appliquerEtatHarness('m-fin', 'terminee', {});
    const resultat = await arreterEquipe({ arreter: async () => {} }, registre, 'm-fin');
    expect(resultat.effet).toBe('applique');
    expect(resultat.etat).toContain('libre');
    expect(registre.missions.lire('m-fin')?.etatHarness).toBe('terminee');
  });

  test('une équipe EN COURS est bien annulée — le correctif ne fait pas disparaître l’annulation', async () => {
    registre.missions.creer({ id: 'm-vif', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    registre.etats.appliquerEtatHarness('m-vif', 'en_cours', {});
    await arreterEquipe({ arreter: async () => {} }, registre, 'm-vif');
    expect(registre.missions.lire('m-vif')?.etatHarness).toBe('annulee');
  });
});

/**
 * `☠ POURQUOI `retirer_mandat` EXISTE` (03/08). Le 02/08 au soir, l'orchestrateur
 * remplace un mandat ancré sur le mauvais projet. Pour retirer le premier, il
 * appelle `arreter_equipe` avec un identifiant de PROPOSITION, lit « mission
 * introuvable », et conclut qu'elle n'existe plus. Elle existait : elle a été
 * autorisée le lendemain matin, sur le mauvais dépôt, et a fait échouer le test.
 */
describe('retirerMandat (03/08)', () => {
  function proposer(id: string, conversationId: string, statut?: 'approuvee'): void {
    registre.conversations.creer({ id: conversationId, titre: 'fil' });
    registre.propositions.creer({
      id,
      conversationId,
      projet: '/mnt/projects/bac-a-sable',
      objectif: 'o',
      critereArret: null,
      perimetre: 'p',
      acces: 'lecture',
      budgetMaxUsd: 5,
      modele: null,
      effort: null,
    });
    if (statut !== undefined) registre.propositions.trancher(id, statut, 'd', 'm-x');
  }

  test('mandat en attente ⇒ retiré, et il ne peut plus être autorisé', () => {
    proposer('prop-1', 'conv-1');
    const resultat = retirerMandat(registre, 'conv-1', 'prop-1');
    expect(resultat.effet).toBe('applique');
    expect(registre.propositions.lire('prop-1')?.statut).toBe('refusee');
    // Le geste qui compte : une autorisation arrivée APRÈS le retrait ne prend pas.
    expect(registre.propositions.trancher('prop-1', 'approuvee', 'd', 'm-y')).toBe(false);
  });

  test('mandat déjà autorisé ⇒ refus qui ORIENTE vers arreter_equipe', () => {
    proposer('prop-2', 'conv-2', 'approuvee');
    const resultat = retirerMandat(registre, 'conv-2', 'prop-2');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('arreter_equipe');
  });

  test('mandat d’un autre fil ⇒ refus', () => {
    proposer('prop-3', 'conv-3');
    expect(retirerMandat(registre, 'conv-autre', 'prop-3').ok).toBe(false);
  });

  test('☠ identifiant d’ÉQUIPE passé par erreur ⇒ le refus nomme la bonne cause', () => {
    // C'est la confusion exacte qui a coûté le test du 03/08 : un refus muet
    // (« mission introuvable ») avait été lu comme « le mandat n'existe plus ».
    registre.missions.creer({ id: 'm-10', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    const resultat = retirerMandat(registre, 'conv-4', 'm-10');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('arreter_equipe');
  });
});

describe('relancerEquipe (B.3.3, resume)', () => {
  test('aucune session à reprendre ⇒ refus', async () => {
    registre.missions.creer({ id: 'm-7', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    const relanceur: RelanceurMission = { relancer: async () => ({ dejaVivant: false }) };
    const resultat = await relancerEquipe(relanceur, registre, 'm-7');
    expect(resultat.ok).toBe(false);
  });

  test("succès ⇒ 'accepte'", async () => {
    registre.missions.creer({
      id: 'm-8',
      lotId: 'lot-1',
      nom: 'x',
      projet: 'alpha',
      compteId: 'compte1',
      sessionId: 'session-8',
    });
    const relanceur: RelanceurMission = { relancer: async () => ({ dejaVivant: false }) };
    const resultat = await relancerEquipe(relanceur, registre, 'm-8');
    expect(resultat.effet).toBe('accepte');
  });

  test('☠ worker DÉJÀ VIVANT ⇒ refus qui oriente vers envoyer_a_equipe, jamais un faux « transmise »', async () => {
    registre.missions.creer({
      id: 'm-9',
      lotId: 'lot-1',
      nom: 'x',
      projet: 'alpha',
      compteId: 'compte1',
      sessionId: 'session-9',
    });
    const relanceur: RelanceurMission = { relancer: async () => ({ dejaVivant: true }) };
    const resultat = await relancerEquipe(relanceur, registre, 'm-9');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('envoyer_a_equipe');
  });
});

/**
 * `☠` `definir_budget` — l'outil que l'orchestrateur a qualifié d'« inopérant sur
 * session démarrée » (02/08). Il l'était : le port levait toujours. Ce qu'il
 * écrit désormais est le plafond du HARNESS, et la réponse distingue ce qui est
 * réellement obtenu (baisse) de ce qui ne l'est pas (hausse, bornée par le SDK).
 */
describe('definirBudget (G, H-68)', () => {
  function equipeAvecBudget(id: string, budget: number, consomme: number): void {
    registre.missions.creer({
      id,
      lotId: 'lot-1',
      nom: 'budget',
      projet: 'alpha',
      compteId: 'compte1',
      sessionId: `sess-${id}`,
      budgetMaxUsd: budget,
    });
    registre.etats.appliquerEtatHarness(id, 'en_cours', { motif: 'test' });
    if (consomme > 0) registre.missions.ajouterCout(id, consomme);
  }

  const definisseurReel: DefinisseurBudget = {
    definir: async (missionId: string, maxUsd: number): Promise<void> => {
      registre.missions.definirBudgetMax(missionId, maxUsd);
    },
  };

  test('☠ BAISSE ⇒ applique, et le registre porte le nouveau plafond', async () => {
    equipeAvecBudget('m-b1', 20, 3);
    const resultat = await definirBudget(definisseurReel, registre, 'm-b1', 5);
    expect(resultat.effet).toBe('applique');
    expect(registre.missions.lire('m-b1')?.budgetMaxUsd).toBe(5);
  });

  test('☠ HAUSSE ⇒ accepte, et la réponse DIT que le SDK coupera avant', async () => {
    equipeAvecBudget('m-b2', 5, 1);
    const resultat = await definirBudget(definisseurReel, registre, 'm-b2', 50);
    expect(resultat.effet).toBe('accepte');
    expect(resultat.etat).toContain('5');
    expect(String(resultat.etat)).toContain('SDK');
  });

  test('valeur absurde ⇒ refus, rien n’est écrit', async () => {
    equipeAvecBudget('m-b3', 20, 0);
    const resultat = await definirBudget(definisseurReel, registre, 'm-b3', -4);
    expect(resultat.ok).toBe(false);
    expect(registre.missions.lire('m-b3')?.budgetMaxUsd).toBe(20);
  });

  test('désignation libre (projet) acceptée', async () => {
    equipeAvecBudget('m-b4', 20, 0);
    const resultat = await definirBudget(definisseurReel, registre, 'alpha', 7);
    expect(resultat.ok).toBe(true);
    expect(registre.missions.lire('m-b4')?.budgetMaxUsd).toBe(7);
  });

  test('équipe inconnue ⇒ refus explicite', async () => {
    const resultat = await definirBudget(definisseurReel, registre, 'fantome', 7);
    expect(resultat.ok).toBe(false);
  });
});

/**
 * `☠` L'issue du dispatch, telle que le modèle la reçoit. Défaut mesuré le
 * 02/08 : `creer_equipe` répondait « équipe lancée » avant tout démarrage, et
 * deux dispatchs échoués (routage machine) n'ont jamais atteint l'orchestrateur
 * — qui a construit la suite de son tour sur une équipe inexistante.
 */
describe('proposerCreationEquipe × issue RÉELLE du dispatch', () => {
  const mandat = ['alpha', 'objectif', null, 'src/**', 'ecriture'] as const;

  async function proposer(depot: Awaited<ReturnType<EnregistreurProposition['enregistrer']>>) {
    return proposerCreationEquipe(
      mandat[0],
      mandat[1],
      mandat[2],
      mandat[3],
      mandat[4],
      registre,
      LECTEUR_PERMISSIF,
      PLAFOND_DESACTIVE,
      { enregistrer: async () => depot },
    );
  }

  test('dispatch PARTI ⇒ applique, avec l’identifiant de la mission réellement créée', async () => {
    const resultat = await proposer({
      ref: 'prop-1',
      autoApprouve: true,
      detail: 'fenêtre d’autonomie ouverte',
      dispatch: { etat: 'parti', missionId: 'm-42', detail: 'équipe démarrée' },
    });
    expect(resultat.effet).toBe('applique');
    expect(resultat.ref).toBe('m-42');
  });

  test('☠ les DEUX identifiants sont étiquetés — celui de l’équipe est désigné comme tel', async () => {
    const resultat = await proposer({
      ref: 'prop-6',
      autoApprouve: true,
      detail: 'fenêtre d’autonomie ouverte',
      dispatch: { etat: 'parti', missionId: 'd35acd69', detail: 'worker démarré : fabdead6' },
    });
    // L'orchestrateur a pris `fabdead6` pour l'équipe au premier essai (02/08) :
    // la réponse doit nommer lequel des deux sert à lui parler.
    expect(resultat.etat).toContain('équipe « d35acd69 »');
    expect(resultat.etat).toContain('envoyer_a_equipe');
    expect(resultat.etat).toContain('fabdead6');
    expect(resultat.etat).toContain('technique');
  });

  test('☠ dispatch ÉCHOUÉ ⇒ refus portant la vraie raison, jamais un « lancée »', async () => {
    const resultat = await proposer({
      ref: 'prop-2',
      autoApprouve: true,
      detail: 'fenêtre d’autonomie ouverte',
      dispatch: {
        etat: 'echec',
        detail: 'conversation af847b10 : aucune machine précisée et plusieurs sont en ligne',
      },
    });
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('aucune machine précisée');
  });

  test('dispatch EN VOL ⇒ accepte, et invite à vérifier avant de compter dessus', async () => {
    const resultat = await proposer({
      ref: 'prop-3',
      autoApprouve: true,
      detail: 'fenêtre d’autonomie ouverte',
      dispatch: { etat: 'en_vol', detail: 'pas de confirmation en 20 s' },
    });
    expect(resultat.effet).toBe('accepte');
    expect(resultat.etat).toContain('lister_equipes');
  });

  test('☠ enregistreur muet sur le dispatch ⇒ accepte, jamais applique', async () => {
    const resultat = await proposer({ ref: 'prop-4', autoApprouve: true, detail: 'auto' });
    expect(resultat.effet).toBe('accepte');
  });

  test('mandat en attente d’un humain ⇒ differe, inchangé (H-61)', async () => {
    const resultat = await proposer({ ref: 'prop-5', autoApprouve: false, detail: 'en attente' });
    expect(resultat.effet).toBe('differe');
  });
});

const ENREGISTREUR_MUET: EnregistreurProposition = {
  enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }),
};

/**
 * Garde 1 — « la vague de trop » (mandat opérateur 21/08, poste à 1 159 $).
 * `☠` PREUVE DANS LES DEUX SENS exigée par le mandat : refus quand la
 * condition est réunie, passage quand elle ne l'est pas — jamais l'un sans
 * l'autre.
 */
describe('proposerCreationEquipe × garde 1 (vague de trop, 24h)', () => {
  test('projet déjà mandaté il y a 1h, pas de campagne ⇒ refus ACTIONNABLE', async () => {
    const maintenant = Date.now();
    registre.missions.creer(
      { id: 'm-recente', lotId: 'lot-1', nom: 'refaire l’auth', projet: 'alpha', compteId: 'compte1' },
      maintenant - 60 * 60 * 1000,
    );
    registre.missions.ajouterCout('m-recente', 3.5);

    const resultat = await proposerCreationEquipe(
      'alpha', 'nouvel objectif', null, 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET, null, null, null, null, null, maintenant,
    );

    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    // Objectif tronqué (nom), coût, heure — l'état montré, pas un refus sec.
    expect(resultat.raison).toContain('refaire l’auth');
    expect(resultat.raison).toContain('3.50');
    // Les deux issues, nommées en clair.
    expect(resultat.raison).toContain('regrouper');
    expect(resultat.raison).toContain('campagne');
  });

  test('même situation, mais `campagne` déclarée ⇒ autorisé (differe)', async () => {
    const maintenant = Date.now();
    registre.missions.creer(
      { id: 'm-recente', lotId: 'lot-1', nom: 'refaire l’auth', projet: 'alpha', compteId: 'compte1' },
      maintenant - 60 * 60 * 1000,
    );

    const resultat = await proposerCreationEquipe(
      'alpha', 'nouvel objectif', null, 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET, null, null, null,
      'refonte auth — vague 2', null, maintenant,
    );

    expect(resultat.effet).toBe('differe');
  });

  test('mission recente mais sur un AUTRE projet ⇒ n’entrave pas celui-ci', async () => {
    const maintenant = Date.now();
    registre.missions.creer(
      { id: 'm-autre', lotId: 'lot-1', nom: 'x', projet: 'beta', compteId: 'compte1' },
      maintenant - 60 * 60 * 1000,
    );

    const resultat = await proposerCreationEquipe(
      'alpha', 'nouvel objectif', null, 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET, null, null, null, null, null, maintenant,
    );

    expect(resultat.effet).toBe('differe');
  });

  test('mission sur ce projet il y a 25h (hors fenêtre) ⇒ n’entrave pas', async () => {
    const maintenant = Date.now();
    registre.missions.creer(
      { id: 'm-vieille', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' },
      maintenant - 25 * 60 * 60 * 1000,
    );

    const resultat = await proposerCreationEquipe(
      'alpha', 'nouvel objectif', null, 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET, null, null, null, null, null, maintenant,
    );

    expect(resultat.effet).toBe('differe');
  });
});

/**
 * Garde 2 — « dispatcher sans regarder le carburant » (mandat opérateur 21/08).
 * `☠` Registre DÉDIÉ, non celui du `beforeEach` global (qui marque le
 * carburant frais par défaut pour ne pas gêner les autres blocs) : ici on a
 * précisément besoin de contrôler cette trace.
 */
describe('proposerCreationEquipe × garde 2 (carburant pas regardé depuis 30 min)', () => {
  test('jamais consulté ⇒ refus qui RETOURNE l’état du carburant', async () => {
    const registreFrais = ouvrirRegistre({ chemin: ':memory:' });
    registreFrais.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/x' });
    registreFrais.lots.creer({ id: 'lot-1', intention: 'x' });

    const resultat = await proposerCreationEquipe(
      'alpha', 'x', null, 'src/**', 'ecriture', registreFrais,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET,
    );

    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('carburant');
    expect(resultat.raison).toContain('30 min');
    registreFrais.fermer();
  });

  test('consulté il y a 40 min (> 30) ⇒ refus', async () => {
    const maintenant = Date.now();
    registre.observationParc.enregistrerConsultationCarburant(maintenant - 40 * 60 * 1000);

    const resultat = await proposerCreationEquipe(
      'alpha', 'x', null, 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET, null, null, null, null, null, maintenant,
    );

    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('carburant');
  });

  test('consulté il y a 10 min (< 30) ⇒ autorisé', async () => {
    const maintenant = Date.now();
    registre.observationParc.enregistrerConsultationCarburant(maintenant - 10 * 60 * 1000);

    const resultat = await proposerCreationEquipe(
      'alpha', 'x', null, 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET, null, null, null, null, null, maintenant,
    );

    expect(resultat.effet).toBe('differe');
  });
});

/**
 * Chantier 2 (mandat opérateur 24/08, mesuré sur 393 mandats : 34 portent un
 * critère que l'équipe ne peut pas vérifier elle-même). `☠` PREUVE DANS LES
 * DEUX SENS : un critère qui ne porte AUCUN des trois marqueurs est refusé,
 * un critère qui en porte un — quel qu'il soit — passe.
 */
describe('proposerCreationEquipe × chantier 2 (critère d’arrêt invérifiable)', () => {
  test('☠ « rapport rendu » ⇒ refus ACTIONNABLE, qui donne un exemple recevable', async () => {
    const resultat = await proposerCreationEquipe(
      'alpha', 'x', 'rapport rendu', 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET,
    );
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('rapport rendu');
    expect(resultat.raison).toContain('invérifiable');
    // Le refus DIT ce qui manque et donne un exemple — jamais un refus sec.
    expect(resultat.raison).toContain('commande entre');
    expect(resultat.raison).toContain('chemin de fichier');
    expect(resultat.raison).toContain('valeur numérique');
    expect(resultat.raison).toMatch(/`[^`]+`/);
  });

  test('☠ « conforme à la densité » (mesuré en audit) ⇒ refus, même raison', async () => {
    const resultat = await proposerCreationEquipe(
      'alpha', 'x', 'conforme à la densité', 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET,
    );
    expect(resultat.ok).toBe(false);
  });

  test('critère avec une commande entre accents graves ⇒ autorisé', async () => {
    const resultat = await proposerCreationEquipe(
      'alpha', 'x', 'rapport rendu, et `bun test` au vert', 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET,
    );
    expect(resultat.effet).toBe('differe');
  });

  test('critère avec un chemin de fichier ⇒ autorisé', async () => {
    const resultat = await proposerCreationEquipe(
      'alpha', 'x', 'README.md créé et docs/API.md mis à jour', 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET,
    );
    expect(resultat.effet).toBe('differe');
  });

  test('critère avec une valeur numérique attendue ⇒ autorisé', async () => {
    const resultat = await proposerCreationEquipe(
      'alpha', 'x', 'moins de 5 erreurs de lint restantes', 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET,
    );
    expect(resultat.effet).toBe('differe');
  });

  test('critère absent (null) ⇒ toujours autorisé — ce chantier ferme un faux critère, pas l’absence', async () => {
    const resultat = await proposerCreationEquipe(
      'alpha', 'x', null, 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET,
    );
    expect(resultat.effet).toBe('differe');
  });
});

/**
 * Chantier 3 (mandat opérateur 24/08, audit 393 mandats : 12 équipes abstenues
 * d’un défaut hors périmètre, devenu le mandat du lendemain). `latitude` doit
 * atteindre le mandat déposé, formulé sans ambiguïté vis-à-vis du périmètre.
 */
describe('proposerCreationEquipe × chantier 3 (champ `latitude`)', () => {
  test('latitude transmise à l’enregistreur, telle quelle', async () => {
    let recu: string | null | undefined;
    const resultat = await proposerCreationEquipe(
      'alpha', 'x', null, 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE,
      { enregistrer: async (mandat) => {
          recu = mandat.latitude;
          return { ref: 'prop-lat', autoApprouve: false, detail: 'en attente' };
        } },
      null, null, null, null, 'corriger les imports cassés rencontrés en route',
    );
    expect(resultat.effet).toBe('differe');
    expect(recu).toBe('corriger les imports cassés rencontrés en route');
  });

  test('☠ la carte d’autorisation formule la latitude SANS AMBIGUÏTÉ vis-à-vis du périmètre', async () => {
    const resultat = await proposerCreationEquipe(
      'alpha', 'x', null, 'src/auth/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET,
      null, null, null, null, 'renommer les variables mal nommées croisées en chemin',
    );
    expect(resultat.etat).toContain('renommer les variables mal nommées croisées en chemin');
    // Le texte dit explicitement que la latitude AUTORISE et que le périmètre
    // l'emporte en cas de recouvrement — jamais un second périmètre silencieux.
    expect(resultat.etat).toContain('emporte en cas de recouvrement');
  });

  test('latitude absente ⇒ la carte le dit explicitement, jamais un silence', async () => {
    const resultat = await proposerCreationEquipe(
      'alpha', 'x', null, 'src/**', 'ecriture', registre,
      LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, ENREGISTREUR_MUET,
    );
    expect(resultat.etat).toContain('Latitude : aucune');
  });
});
