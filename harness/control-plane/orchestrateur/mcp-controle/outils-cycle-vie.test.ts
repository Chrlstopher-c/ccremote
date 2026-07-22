import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { arreterEquipe, envoyerAEquipe, interrompreEquipe, proposerCreationEquipe, relancerEquipe } from './outils-cycle-vie.ts';
import type {
  ArreteurMission,
  CibleEquipe,
  ConfigPlafondParc,
  LecteurUtilisationParc,
  RelanceurMission,
  RepertoireCibles,
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

function fabriquerCible(overrides: Partial<CibleEquipe> = {}): CibleEquipe {
  return {
    envoyerMessage: async () => {},
    interrupt: async () => ({ still_queued: [] }),
    ...overrides,
  };
}

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
  test("retourne 'differe' avec une proposition de mandat, jamais 'applique'", () => {
    const resultat = proposerCreationEquipe(
      'alpha',
      'refaire l’auth',
      'tests verts',
      'src/auth/**',
      LECTEUR_PERMISSIF,
      PLAFOND_DESACTIVE,
    );
    expect(resultat.effet).toBe('differe');
    expect(resultat.ref).toBeDefined();
    expect(resultat.etat).toContain('refaire l’auth');
  });

  test('☠ ne touche à AUCUN registre — aucune mission créée', () => {
    proposerCreationEquipe('alpha', 'x', 'y', 'z', LECTEUR_PERMISSIF, PLAFOND_DESACTIVE);
    expect(registre.missions.listerActives().length).toBe(0);
  });
});

describe('proposerCreationEquipe × plafond de parc (G.1.3 — câblage réel, M-53 corrigé)', () => {
  test('seuil bas dépassé sur le seul compte connu ⇒ refus, jamais differe', () => {
    const lecteur = fabriquerLecteur({
      compte1: [{ compteId: 'compte1', typeFenetre: 'five_hour', utilisation: 90, statut: 'allowed' }],
    });
    const resultat = proposerCreationEquipe('alpha', 'x', null, 'src/**', lecteur, { seuilUtilisationPct: 10 });
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('compte1');
    expect(resultat.raison).toContain('five_hour');
  });

  test('seuil haut, sous le seuil ⇒ autorisé, differe', () => {
    const lecteur = fabriquerLecteur({
      compte1: [{ compteId: 'compte1', typeFenetre: 'five_hour', utilisation: 20, statut: 'allowed' }],
    });
    const resultat = proposerCreationEquipe('alpha', 'x', null, 'src/**', lecteur, { seuilUtilisationPct: 85 });
    expect(resultat.effet).toBe('differe');
  });

  test('un compte saturé mais un second disponible ⇒ autorisé (au moins un compte viable)', () => {
    const lecteur = fabriquerLecteur({
      compte1: [{ compteId: 'compte1', typeFenetre: 'five_hour', utilisation: 99, statut: 'allowed' }],
      compte2: [{ compteId: 'compte2', typeFenetre: 'five_hour', utilisation: 5, statut: 'allowed' }],
    });
    const resultat = proposerCreationEquipe('alpha', 'x', null, 'src/**', lecteur, { seuilUtilisationPct: 85 });
    expect(resultat.effet).toBe('differe');
  });

  test('tous les comptes saturés ⇒ refus, motif lisible par compte', () => {
    const lecteur = fabriquerLecteur({
      compte1: [{ compteId: 'compte1', typeFenetre: 'five_hour', utilisation: 90, statut: 'allowed' }],
      compte2: [{ compteId: 'compte2', typeFenetre: 'seven_day', utilisation: 95, statut: 'allowed' }],
    });
    const resultat = proposerCreationEquipe('alpha', 'x', null, 'src/**', lecteur, { seuilUtilisationPct: 85 });
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('compte1');
    expect(resultat.raison).toContain('compte2');
  });

  test('aucun compte connu ⇒ rien à borner, autorisé', () => {
    const resultat = proposerCreationEquipe('alpha', 'x', null, 'src/**', LECTEUR_PERMISSIF, { seuilUtilisationPct: 1 });
    expect(resultat.effet).toBe('differe');
  });

  test('☠ un port qui lève une exception ne bloque jamais l’outil ⇒ refus propre, pas de throw', () => {
    const lecteur: LecteurUtilisationParc = {
      comptesConnus: () => {
        throw new Error('port hors service');
      },
      releves: () => [],
    };
    const resultat = proposerCreationEquipe('alpha', 'x', null, 'src/**', lecteur, PLAFOND_DESACTIVE);
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('port hors service');
  });
});

describe('envoyerAEquipe (H-67 — mise en file, jamais une interruption)', () => {
  test('équipe introuvable ⇒ refus explicite', async () => {
    const repertoire: RepertoireCibles = { cible: () => null };
    const resultat = await envoyerAEquipe(repertoire, 'inconnue', 'salut');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('introuvable');
  });

  test("succès ⇒ 'accepte', jamais 'applique' (l’équipe n’a pas encore lu le message)", async () => {
    let recu: unknown;
    const cible = fabriquerCible({ envoyerMessage: async (m) => void (recu = m) });
    const repertoire: RepertoireCibles = { cible: () => cible };
    const resultat = await envoyerAEquipe(repertoire, 'm-1', 'fais X');
    expect(resultat.effet).toBe('accepte');
    expect(recu).toBeDefined();
  });

  test('le message porte le préfixe structurel émetteur:orchestrateur (H-66)', async () => {
    let recu: { message: { content: string } } | undefined;
    const cible = fabriquerCible({ envoyerMessage: async (m) => void (recu = m as never) });
    const repertoire: RepertoireCibles = { cible: () => cible };
    await envoyerAEquipe(repertoire, 'm-1', 'fais X');
    expect(recu?.message.content).toContain('[émetteur:orchestrateur]');
  });

  test('☠ (a) un port qui ne répond jamais ⇒ refus rapide, pas de blocage', async () => {
    const cible = fabriquerCible({ envoyerMessage: () => new Promise(() => {}) });
    const repertoire: RepertoireCibles = { cible: () => cible };
    const debut = Date.now();
    const resultat = await envoyerAEquipe(repertoire, 'm-1', 'x', 30);
    expect(Date.now() - debut).toBeLessThan(500);
    expect(resultat.ok).toBe(false);
  });
});

describe('interrompreEquipe (B.4)', () => {
  test('résolution du port ⇒ applique (la résolution EST la confirmation)', async () => {
    const cible = fabriquerCible({ interrupt: async () => ({ still_queued: ['u-1'] }) });
    const repertoire: RepertoireCibles = { cible: () => cible };
    const resultat = await interrompreEquipe(repertoire, 'm-1');
    expect(resultat.effet).toBe('applique');
  });

  test('reçu dégradé (undefined) ⇒ toujours applique, jamais une erreur (H-46)', async () => {
    const cible = fabriquerCible({ interrupt: async () => undefined });
    const repertoire: RepertoireCibles = { cible: () => cible };
    const resultat = await interrompreEquipe(repertoire, 'm-1');
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('dégradé');
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
    expect(resultat.effet).toBe('accepte');
    expect(registre.missions.lire('m-5')?.etatHarness).toBe('annulee');
  });

  test('☠ (a) port de teardown qui ne répond jamais ⇒ retour rapide, registre déjà à jour', async () => {
    registre.missions.creer({ id: 'm-6', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    const arreteur: ArreteurMission = { arreter: () => new Promise(() => {}) };
    const debut = Date.now();
    const resultat = await arreterEquipe(arreteur, registre, 'm-6', 30);
    expect(Date.now() - debut).toBeLessThan(500);
    expect(resultat.effet).toBe('accepte');
    expect(registre.missions.lire('m-6')?.etatHarness).toBe('annulee');
  });
});

describe('relancerEquipe (B.3.3, resume)', () => {
  test('aucune session à reprendre ⇒ refus', async () => {
    registre.missions.creer({ id: 'm-7', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    const relanceur: RelanceurMission = { relancer: async () => {} };
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
    const relanceur: RelanceurMission = { relancer: async () => {} };
    const resultat = await relancerEquipe(relanceur, registre, 'm-8');
    expect(resultat.effet).toBe('accepte');
  });
});
