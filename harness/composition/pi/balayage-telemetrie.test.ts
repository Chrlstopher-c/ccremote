import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../control-plane/registre/index.ts';
import type { TelemetrieWorker } from '../../superviseur/index.ts';

// `☠` Espionne le logger AVANT d'importer `balayage-telemetrie.ts` — le
// module y construit son `log = compositionLogger.child(...)` une seule fois,
// à l'import. `mock.module` est hissé par Bun en tête de fichier : cet appel
// s'exécute avant la résolution du graphe d'imports qui suit textuellement.
const avertissements: { message: string; contexte: unknown }[] = [];
mock.module('../logger.ts', () => ({
  compositionLogger: {
    child: () => ({
      warn: (contexte: unknown, message: string) => avertissements.push({ message, contexte }),
      debug: () => {},
      info: () => {},
      error: () => {},
    }),
  },
}));

const { demarrerBalayageTelemetrie } = await import('./balayage-telemetrie.ts');

let registre: Registre;

const RELEVE: TelemetrieWorker = {
  missionId: 'm-1',
  sessionId: 's-1',
  vivant: true,
  modeleResolu: 'claude-sonnet-5',
  etatSdk: 'idle',
  coutUsd: 0.23,
  contexteTokensUtilises: 45_828,
  contexteTokensMax: 967_000,
  contexteVentilation: [{ nom: 'Messages', tokens: 10_326, differe: false }],
  derniereActivite: null,
  activitesEnAttente: [],
  resultatsEnAttente: [],
  sousAgents: [],
  tachesFond: [],
  quotaSature: false,
  motifQuota: null,
  observeA: 0,
};

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-compte1' });
  registre.lots.creer({ id: 'lot-1', intention: 'analyse' });
  registre.missions.creer({ id: 'm-1', lotId: 'lot-1', nom: 'vela', projet: 'vela', compteId: 'compte1' });
  registre.etats.appliquerEtatHarness('m-1', 'en_cours');
  avertissements.length = 0;
});

afterEach(() => registre.fermer());

function balayer(releve: TelemetrieWorker, reconcilier?: () => Promise<unknown>) {
  const b = demarrerBalayageTelemetrie({
    registre,
    source: { telemetrie: async () => [releve] },
    ...(reconcilier !== undefined ? { reconcilier } : {}),
  });
  return b;
}

describe('balayage-telemetrie — mort d’un worker en cours de route', () => {
  test('☠ un worker MORT sur une mission active déclenche la réconciliation (23/07)', async () => {
    let appels = 0;
    const b = balayer({ ...RELEVE, vivant: false }, async () => { appels += 1; });
    await b.passer();
    b.arreter();
    // Sans ce déclenchement, la mission restait `en_cours` à jamais : reconcilier()
    // ne tourne qu'au démarrage du Pi et à la reconnexion du PC.
    expect(appels).toBe(1);
  });

  test('un worker vivant ne déclenche jamais de réconciliation', async () => {
    let appels = 0;
    const b = balayer(RELEVE, async () => { appels += 1; });
    await b.passer();
    b.arreter();
    expect(appels).toBe(0);
  });

  test('un worker mort sur une mission DÉJÀ terminée ne déclenche rien', async () => {
    registre.etats.appliquerEtatHarness('m-1', 'terminee');
    let appels = 0;
    const b = balayer({ ...RELEVE, vivant: false }, async () => { appels += 1; });
    await b.passer();
    b.arreter();
    expect(appels).toBe(0);
  });

  test('☠ une réconciliation qui échoue n’interrompt pas le balayage', async () => {
    const b = balayer({ ...RELEVE, vivant: false }, async () => { throw new Error('PC injoignable'); });
    await b.passer();
    b.arreter();
    // Le relevé a tout de même été appliqué : perdre la télémétrie parce que la
    // réconciliation a échoué serait un très mauvais échange.
    expect(registre.missions.lire('m-1')?.modeleResolu).toBe('claude-sonnet-5');
  });

  test('la ventilation du contexte est persistée telle que mesurée', async () => {
    const b = balayer(RELEVE);
    await b.passer();
    b.arreter();
    const m = registre.missions.lire('m-1');
    expect(m?.contexteTokensUtilises).toBe(45_828);
    expect(m?.contexteVentilation).toEqual([{ nom: 'Messages', tokens: 10_326, differe: false }]);
  });
});

describe('balayage-telemetrie — ce que l’équipe produit', () => {
  test('☠ les textes produits entrent au fil de la mission (23/07)', async () => {
    const b = balayer({
      ...RELEVE,
      activitesEnAttente: [
        { texte: 'Rapport : le projet compile.', survenuA: 1_000, type: 'texte' as const },
        { texte: 'Rien à signaler côté tests.', survenuA: 2_000, type: 'texte' as const },
      ],
    });
    await b.passer();
    b.arreter();
    const activites = registre.missions.activites('m-1');
    expect(activites).toHaveLength(2);
    expect(activites[0]?.texte).toContain('le projet compile');
  });

  test('☠ un second passage sans nouvelle activité ne duplique rien', async () => {
    const releve = { ...RELEVE, activitesEnAttente: [{ texte: 'un seul message', survenuA: 1_000, type: 'texte' as const }] };
    const b = demarrerBalayageTelemetrie({
      registre,
      // Le PC draine sa file : le second relevé ne reporte plus l'activité.
      source: { telemetrie: async () => [{ ...releve, activitesEnAttente: [] }] },
    });
    const premier = demarrerBalayageTelemetrie({ registre, source: { telemetrie: async () => [releve] } });
    await premier.passer();
    premier.arreter();
    await b.passer();
    b.arreter();
    expect(registre.missions.activites('m-1')).toHaveLength(1);
  });
});

/**
 * `☠` LE plafond de dépense devient un fait vérifiable ici. Avant le 02/08,
 * `budgetMaxUsd` était écrit au registre, affiché dans `etat_equipe`, et comparé
 * à RIEN : le seul plafond réel était celui posé au SDK au démarrage de la
 * session, figé pour toute sa vie — d'où un `definir_budget` que l'orchestrateur
 * a fini par qualifier d'« inopérant sur session démarrée ».
 */
describe('balayage-telemetrie — plafond de dépense (G, filet H-68)', () => {
  function balayerAvecPlafond(
    releve: TelemetrieWorker,
    coupes: { missionId: string; motif: string }[],
  ): ReturnType<typeof demarrerBalayageTelemetrie> {
    return demarrerBalayageTelemetrie({
      registre,
      source: { telemetrie: async () => [releve] },
      arreterSurPlafond: async (missionId, motif) => {
        coupes.push({ missionId, motif });
      },
    });
  }

  test('☠ dépassement ⇒ l’équipe est COUPÉE, avec le montant dans le motif', async () => {
    registre.missions.definirBudgetMax('m-1', 1);
    const coupes: { missionId: string; motif: string }[] = [];
    const b = balayerAvecPlafond({ ...RELEVE, coutUsd: 1.4 }, coupes);
    await b.passer();
    b.arreter();
    expect(coupes).toHaveLength(1);
    expect(coupes[0]?.missionId).toBe('m-1');
    expect(coupes[0]?.motif).toContain('1.40');
  });

  test('sous le plafond ⇒ rien n’est coupé', async () => {
    registre.missions.definirBudgetMax('m-1', 10);
    const coupes: { missionId: string; motif: string }[] = [];
    const b = balayerAvecPlafond({ ...RELEVE, coutUsd: 1.4 }, coupes);
    await b.passer();
    b.arreter();
    expect(coupes).toEqual([]);
  });

  test('☠ une BAISSE de plafond en cours de route coupe une équipe déjà lancée', async () => {
    const coupes: { missionId: string; motif: string }[] = [];
    const b = balayerAvecPlafond({ ...RELEVE, coutUsd: 3 }, coupes);
    registre.missions.definirBudgetMax('m-1', 20);
    await b.passer();
    expect(coupes).toEqual([]);
    // C'est le geste que `definir_budget` déclenche : le plafond passe SOUS le
    // consommé, et l'équipe doit s'arrêter au relevé suivant.
    registre.missions.definirBudgetMax('m-1', 2);
    await b.passer();
    b.arreter();
    expect(coupes).toHaveLength(1);
  });

  test('☠ une mission DÉJÀ arrêtée ne redéclenche pas de coupure à chaque passe', async () => {
    registre.missions.definirBudgetMax('m-1', 1);
    const coupes: { missionId: string; motif: string }[] = [];
    const b = balayerAvecPlafond({ ...RELEVE, coutUsd: 1.4 }, coupes);
    await b.passer();
    registre.etats.appliquerEtatHarness('m-1', 'annulee', { motif: 'plafond' });
    await b.passer();
    await b.passer();
    b.arreter();
    expect(coupes).toHaveLength(1);
  });

  test('☠ sans arrêt câblé, le dépassement n’explose pas — il est seulement journalisé', async () => {
    registre.missions.definirBudgetMax('m-1', 1);
    const b = demarrerBalayageTelemetrie({
      registre,
      source: { telemetrie: async () => [{ ...RELEVE, coutUsd: 5 }] },
    });
    await b.passer();
    b.arreter();
    expect(registre.missions.lire('m-1')?.etatHarness).toBe('en_cours');
  });
});

/**
 * `☠` La colonne (migration 32) et `poserAvertissementBudget80` existaient
 * déjà, posés et testés isolément — rien ne les déclenchait ni ne transmettait
 * le message. 414 $ du parc sont partis dans des missions coupées net qui
 * n'ont jamais rendu leur rapport, faute de préavis.
 */
describe('balayage-telemetrie — préavis de plafond à 80 % (migration 32)', () => {
  function balayerAvecPreavis(
    releve: TelemetrieWorker,
    preavis: { missionId: string; texte: string }[],
  ): ReturnType<typeof demarrerBalayageTelemetrie> {
    return demarrerBalayageTelemetrie({
      registre,
      source: { telemetrie: async () => [releve] },
      avertirBudget80: async (missionId, texte) => {
        preavis.push({ missionId, texte });
      },
    });
  }

  test('☠ 80 % du plafond franchi ⇒ le préavis part, une seule fois', async () => {
    registre.missions.definirBudgetMax('m-1', 10);
    const preavis: { missionId: string; texte: string }[] = [];
    const b = balayerAvecPreavis({ ...RELEVE, coutUsd: 8 }, preavis);
    await b.passer();
    await b.passer();
    b.arreter();
    expect(preavis).toHaveLength(1);
    expect(preavis[0]?.missionId).toBe('m-1');
    expect(preavis[0]?.texte).toContain('rapport');
  });

  test('sous 80 % ⇒ rien n’est envoyé', async () => {
    registre.missions.definirBudgetMax('m-1', 10);
    const preavis: { missionId: string; texte: string }[] = [];
    const b = balayerAvecPreavis({ ...RELEVE, coutUsd: 5 }, preavis);
    await b.passer();
    b.arreter();
    expect(preavis).toEqual([]);
  });

  test('☠ la marque en base survit à un second passage même sans plus de câblage', async () => {
    registre.missions.definirBudgetMax('m-1', 10);
    const b = demarrerBalayageTelemetrie({
      registre,
      source: { telemetrie: async () => [{ ...RELEVE, coutUsd: 8 }] },
    });
    await b.passer();
    b.arreter();
    expect(registre.missions.lire('m-1')?.avertissementBudget80A).not.toBeNull();
  });

  test('☠ sans envoi câblé, le franchissement n’explose pas — il est seulement journalisé', async () => {
    registre.missions.definirBudgetMax('m-1', 10);
    const b = demarrerBalayageTelemetrie({
      registre,
      source: { telemetrie: async () => [{ ...RELEVE, coutUsd: 9 }] },
    });
    await b.passer();
    b.arreter();
    expect(registre.missions.lire('m-1')?.etatHarness).toBe('en_cours');
  });
});

/**
 * `☠` GARDE D'OBSERVABILITÉ (chantier 3, 24/08) — le symptôme mesuré sur la
 * base de production : un tour se termine, un coût est RÉELLEMENT facturé,
 * mais aucune activité n'a jamais atteint `activite_mission` pour cette
 * mission. 11 missions sur 401 (2,7 %) dans deux fenêtres compactes (23/07,
 * 20/08), jamais découvertes avant une requête SQL manuelle un mois plus
 * tard. Ce garde-fou ne corrige pas le canal cassé (hors de ce fichier) : il
 * rend l'anomalie visible EN TEMPS RÉEL dans les logs du Pi.
 */
describe('balayage-telemetrie — garde d’observabilité « coût facturé sans activité » (chantier 3, 24/08)', () => {
  test('☠ tour fini + coût facturé + AUCUNE activité jamais vue ⇒ avertissement journalisé', async () => {
    // Premier passage : le worker démarre un tour (`running`), rien à facturer
    // encore, aucune activité — exactement le symptôme mesuré (le canal de
    // coût suit un chemin séparé du canal d'activités).
    const premier = demarrerBalayageTelemetrie({
      registre,
      source: { telemetrie: async () => [{ ...RELEVE, etatSdk: 'running', coutUsd: 0, activitesEnAttente: [] }] },
    });
    await premier.passer();
    premier.arreter();
    expect(avertissements).toEqual([]);

    // Second passage : le tour se termine (`running → idle`), un coût réel
    // est facturé, mais toujours aucune activité dans ce relevé NI dans aucun
    // relevé précédent — le symptôme exact.
    const second = demarrerBalayageTelemetrie({
      registre,
      source: { telemetrie: async () => [{ ...RELEVE, etatSdk: 'idle', coutUsd: 1.67, activitesEnAttente: [] }] },
    });
    await second.passer();
    second.arreter();

    expect(avertissements).toHaveLength(1);
    expect(avertissements[0]?.message).toContain('AUCUNE activité');
    expect(avertissements[0]?.contexte).toMatchObject({ missionId: 'm-1', coutUsd: 1.67 });
  });

  test('tour fini + coût facturé + une activité déjà connue ⇒ rien à signaler', async () => {
    const premier = demarrerBalayageTelemetrie({
      registre,
      source: {
        telemetrie: async () => [
          {
            ...RELEVE,
            etatSdk: 'running',
            coutUsd: 0,
            activitesEnAttente: [{ texte: 'je travaille', survenuA: 1_000, type: 'texte' as const }],
          },
        ],
      },
    });
    await premier.passer();
    premier.arreter();

    const second = demarrerBalayageTelemetrie({
      registre,
      source: { telemetrie: async () => [{ ...RELEVE, etatSdk: 'idle', coutUsd: 1.2, activitesEnAttente: [] }] },
    });
    await second.passer();
    second.arreter();

    expect(avertissements).toEqual([]);
  });

  test('tour fini SANS coût facturé (0 $) ⇒ rien à signaler, même sans activité', async () => {
    const premier = demarrerBalayageTelemetrie({
      registre,
      source: { telemetrie: async () => [{ ...RELEVE, etatSdk: 'running', coutUsd: 0, activitesEnAttente: [] }] },
    });
    await premier.passer();
    premier.arreter();

    const second = demarrerBalayageTelemetrie({
      registre,
      source: { telemetrie: async () => [{ ...RELEVE, etatSdk: 'idle', coutUsd: 0, activitesEnAttente: [] }] },
    });
    await second.passer();
    second.arreter();

    expect(avertissements).toEqual([]);
  });
});
