import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../control-plane/registre/index.ts';
import type { TelemetrieWorker } from '../../superviseur/index.ts';
import { demarrerBalayageTelemetrie } from './balayage-telemetrie.ts';

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
        { texte: 'Rapport : le projet compile.', survenuA: 1_000 },
        { texte: 'Rien à signaler côté tests.', survenuA: 2_000 },
      ],
    });
    await b.passer();
    b.arreter();
    const activites = registre.missions.activites('m-1');
    expect(activites).toHaveLength(2);
    expect(activites[0]?.texte).toContain('le projet compile');
  });

  test('☠ un second passage sans nouvelle activité ne duplique rien', async () => {
    const releve = { ...RELEVE, activitesEnAttente: [{ texte: 'un seul message', survenuA: 1_000 }] };
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
