import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { arreterEquipe, envoyerAEquipe, interrompreEquipe, proposerCreationEquipe, relancerEquipe } from './outils-cycle-vie.ts';
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
      'tests verts',
      'src/auth/**',
      'ecriture',
      LECTEUR_PERMISSIF,
      PLAFOND_DESACTIVE,
      { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) },
    );
    expect(resultat.effet).toBe('differe');
    expect(resultat.ref).toBeDefined();
    expect(resultat.etat).toContain('refaire l’auth');
  });

  test('☠ ne touche à AUCUN registre — aucune mission créée', async () => {
    await proposerCreationEquipe('alpha', 'x', 'y', 'z', 'ecriture', LECTEUR_PERMISSIF, PLAFOND_DESACTIVE, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
    expect(registre.missions.listerActives().length).toBe(0);
  });
});

describe('proposerCreationEquipe × plafond de parc (G.1.3 — câblage réel, M-53 corrigé)', () => {
  test('seuil bas dépassé sur le seul compte connu ⇒ refus, jamais differe', async () => {
    const lecteur = fabriquerLecteur({
      compte1: [{ compteId: 'compte1', typeFenetre: 'five_hour', utilisation: 90, statut: 'allowed' }],
    });
    const resultat = await proposerCreationEquipe('alpha', 'x', null, 'src/**', 'ecriture', lecteur, { seuilUtilisationPct: 10 }, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('compte1');
    expect(resultat.raison).toContain('five_hour');
  });

  test('seuil haut, sous le seuil ⇒ autorisé, differe', async () => {
    const lecteur = fabriquerLecteur({
      compte1: [{ compteId: 'compte1', typeFenetre: 'five_hour', utilisation: 20, statut: 'allowed' }],
    });
    const resultat = await proposerCreationEquipe('alpha', 'x', null, 'src/**', 'ecriture', lecteur, { seuilUtilisationPct: 85 }, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
    expect(resultat.effet).toBe('differe');
  });

  test('un compte saturé mais un second disponible ⇒ autorisé (au moins un compte viable)', async () => {
    const lecteur = fabriquerLecteur({
      compte1: [{ compteId: 'compte1', typeFenetre: 'five_hour', utilisation: 99, statut: 'allowed' }],
      compte2: [{ compteId: 'compte2', typeFenetre: 'five_hour', utilisation: 5, statut: 'allowed' }],
    });
    const resultat = await proposerCreationEquipe('alpha', 'x', null, 'src/**', 'ecriture', lecteur, { seuilUtilisationPct: 85 }, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
    expect(resultat.effet).toBe('differe');
  });

  test('tous les comptes saturés ⇒ refus, motif lisible par compte', async () => {
    const lecteur = fabriquerLecteur({
      compte1: [{ compteId: 'compte1', typeFenetre: 'five_hour', utilisation: 90, statut: 'allowed' }],
      compte2: [{ compteId: 'compte2', typeFenetre: 'seven_day', utilisation: 95, statut: 'allowed' }],
    });
    const resultat = await proposerCreationEquipe('alpha', 'x', null, 'src/**', 'ecriture', lecteur, { seuilUtilisationPct: 85 }, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('compte1');
    expect(resultat.raison).toContain('compte2');
  });

  test('aucun compte connu ⇒ rien à borner, autorisé', async () => {
    const resultat = await proposerCreationEquipe('alpha', 'x', null, 'src/**', 'ecriture', LECTEUR_PERMISSIF, { seuilUtilisationPct: 1 }, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
    expect(resultat.effet).toBe('differe');
  });

  test('☠ un port qui lève une exception ne bloque jamais l’outil ⇒ refus propre, pas de throw', async () => {
    const lecteur: LecteurUtilisationParc = {
      comptesConnus: () => {
        throw new Error('port hors service');
      },
      releves: () => [],
    };
    const resultat = await proposerCreationEquipe('alpha', 'x', null, 'src/**', 'ecriture', lecteur, PLAFOND_DESACTIVE, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });
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
