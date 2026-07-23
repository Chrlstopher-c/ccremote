import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { versMissionApi } from './vue-missions.ts';

let registre: Registre;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-compte1' });
  registre.lots.creer({ id: 'lot-1', intention: 'analyse' });
  registre.missions.creer({ id: 'm-1', lotId: 'lot-1', nom: 'vela', projet: 'vela', compteId: 'compte1' });
});

afterEach(() => registre.fermer());

function vue() {
  const m = registre.missions.lire('m-1');
  if (m === null) throw new Error('mission absente');
  return versMissionApi(m, 3);
}

describe('vue-missions — état affiché', () => {
  test('☠ mission ouverte dont le lead a fini son tour ⇒ idle, pas running (23/07)', () => {
    registre.etats.appliquerEtatHarness('m-1', 'en_cours');
    registre.etats.appliquerEtatSdk('m-1', 'running');
    expect(vue().state).toBe('running');
    // Le lead rend la main : rien ne tourne, rien ne consomme. Afficher
    // « running » ferait attendre un résultat qui ne viendra pas seul.
    registre.etats.appliquerEtatSdk('m-1', 'idle');
    expect(vue().state).toBe('idle');
  });

  test('un repos SDK ne masque jamais un état harness plus fort', () => {
    registre.etats.appliquerEtatHarness('m-1', 'en_cours');
    registre.etats.appliquerEtatSdk('m-1', 'idle');
    registre.etats.appliquerEtatHarness('m-1', 'en_pause');
    expect(vue().state).toBe('paused');
    registre.etats.appliquerEtatHarness('m-1', 'terminee');
    expect(vue().state).toBe('terminee');
  });

  test('idleAgo date de la transition SDK, pas du dispatch', () => {
    registre.etats.appliquerEtatHarness('m-1', 'en_cours', { maintenant: 1_000 });
    registre.etats.appliquerEtatSdk('m-1', 'idle');
    const m = registre.missions.lire('m-1');
    if (m === null) throw new Error('mission absente');
    // Repère SDK récent : l'ancienneté doit être courte, pas l'âge du dispatch.
    const rendu = versMissionApi(m, 3, (m.etatSdkMajA ?? 0) + 1_000);
    expect(rendu.idleAgo).not.toBeNull();
    expect(rendu.idleAgo).not.toContain('h');
  });
});

describe('vue-missions — contexte', () => {
  test('sans relevé : 0 %, tokens nuls, détail vide — jamais une extrapolation', () => {
    const v = vue();
    expect(v.ctx).toBe(0);
    expect(v.ctxTokens).toEqual({ utilises: null, max: null });
    expect(v.ctxDetail).toEqual([]);
  });

  test('☠ la ventilation distingue socle et travail réel (mesuré le 23/07)', () => {
    registre.missions.definirUsageContexte('m-1', 34_718, 967_000, [
      { nom: 'System prompt', tokens: 263, differe: false },
      { nom: 'Memory files', tokens: 11_596, differe: false },
      { nom: 'MCP tools (deferred)', tokens: 20_136, differe: true },
      { nom: 'Messages', tokens: 10_326, differe: false },
    ]);
    const v = vue();
    expect(v.ctx).toBe(4);
    expect(v.ctxTokens.utilises).toBe(34_718);
    expect(v.ctxDetail).toHaveLength(4);
    // Les postes différés sont annoncés mais PAS chargés : les additionner au
    // total ferait dépasser le réel.
    expect(v.ctxDetail.find((p) => p.nom.includes('MCP'))?.differe).toBe(true);
  });

  test('☠ un relevé sans ventilation n’efface pas la dernière connue', () => {
    registre.missions.definirUsageContexte('m-1', 1_000, 967_000, [
      { nom: 'Messages', tokens: 900, differe: false },
    ]);
    registre.missions.definirUsageContexte('m-1', 2_000, 967_000, null);
    const v = vue();
    expect(v.ctxTokens.utilises).toBe(2_000);
    expect(v.ctxDetail).toHaveLength(1);
  });
});
