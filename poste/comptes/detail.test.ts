import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { DetailCompte, type UsageSdk } from '../../commun/compte-detail.ts';
import { lireDetail } from './detail.ts';

const lire = (nom: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${nom}`, import.meta.url), 'utf8'));

const SDK: UsageSdk = {
  sessionId: 's1',
  session: { total_cost_usd: 0.5 },
  abonnement: 'max',
  contributeurs: null,
  luLe: '2026-11-20T10:00:00.000Z',
};

function detailDeFixtures(): DetailCompte {
  return lireDetail({
    compte: 'principal',
    machine: 'tour',
    releveLe: '2026-11-20T10:00:00.000Z',
    profil: lire('profile.json'),
    usage: lire('usage.json'),
    usageCedar: lire('usage_cedar.json'),
    prepaye: lire('prepaid.json'),
    sdk: SDK,
    problemes: [],
  });
}

describe('vue complète d’un compte (fixtures réelles, anonymisées)', () => {
  test('le résultat passe le contrat DetailCompte', () => {
    expect(() => DetailCompte.parse(detailDeFixtures())).not.toThrow();
  });

  test('profil : nom, abonnement, sans l’uuid d’organisation', () => {
    const d = detailDeFixtures();
    expect(d.profil?.nom).toBe('Chris');
    expect(d.profil?.max).toBe(true);
    expect(d.profil?.niveauLimites).toBe('default_claude_max_5x');
    expect(JSON.stringify(d)).not.toContain('00000000-0000-4000-8000-000000000002');
  });

  test('fenêtres : five_hour 17 et seven_day 84, sans extra_usage', () => {
    const d = detailDeFixtures();
    expect(d.fenetres.map((f) => [f.cle, f.pourcent])).toEqual([
      ['five_hour', 17],
      ['seven_day', 84],
    ]);
  });

  test('limites : trois lignes dans l’ordre, la ligne Fable porte son modèle', () => {
    const d = detailDeFixtures();
    expect(d.limites.map((l) => l.genre)).toEqual(['session', 'weekly_all', 'weekly_scoped']);
    expect(d.limites[2]?.modele).toBe('Fable');
    expect(d.limites[1]?.active).toBe(true);
  });

  test('extra_usage inactif, désactivé par l’utilisateur', () => {
    const u = detailDeFixtures().usageSupplementaire;
    expect(u?.active).toBe(false);
    expect(u?.desactiveParUtilisateur).toBe(true);
  });

  test('réinitialisations : trois offres, une disponible, la prochaine est full-reset-2611', () => {
    const r = detailDeFixtures().reinitialisations;
    expect(r?.offres).toHaveLength(3);
    expect(r?.disponibles).toBe(1);
    expect(r?.prochaine).toBe('full-reset-2611');
    expect(r?.offres[0]).toMatchObject({ id: 'full-reset-2611', utilisableMaintenant: true, restantes: 1 });
    expect(r?.offres[0]?.pourcentsUtilises['seven_day']).toBe(84);
  });

  test('crédits prépayés : solde 54 EUR', () => {
    expect(detailDeFixtures().creditsPrepayes?.solde).toEqual({ mineur: 54, devise: 'EUR', exposant: 2 });
  });

  test('répartition de la semaine : quatre lignes', () => {
    expect(detailDeFixtures().repartitionSemaine?.lignes).toHaveLength(4);
    expect(detailDeFixtures().repartitionSemaine?.lignes[0]).toMatchObject({ cle: 'claude_code', pourcent: 95 });
  });

  test('parts par modèle et session SDK reprises telles quelles', () => {
    const d = detailDeFixtures();
    expect(d.partsModeles).toEqual([{ indexLimite: 2, pourcentSemaine: 1, allocationPourcent: 50 }]);
    expect(d.sdk).toEqual(SDK);
  });

  test('autres : clés non nulles hors fenêtres et blocs lus (member_dashboard_available)', () => {
    expect(Object.keys(detailDeFixtures().autres)).toEqual(['member_dashboard_available']);
  });
});

describe('lireDetail : valeurs mal formées, pas d’exception', () => {
  const vide = {
    compte: 'x',
    machine: 'm',
    releveLe: 'r',
    profil: null,
    usage: null,
    usageCedar: null,
    prepaye: null,
    sdk: null,
    problemes: [],
  };

  test('tout absent : aucune lecture, champs à null ou vides', () => {
    const d = lireDetail(vide);
    expect(DetailCompte.parse(d)).toBeDefined();
    expect(d.fenetres).toEqual([]);
    expect(d.limites).toEqual([]);
    expect(d.reinitialisations).toBeNull();
    expect(d.probleme).toBeNull();
  });

  test('limites et offres malformées sont écartées, les bonnes restent', () => {
    const d = lireDetail({
      ...vide,
      usage: { limits: [null, 'x', { kind: 'session' }, { kind: 'weekly_all', percent: 3 }], five_hour: 'abc' },
      usageCedar: { cedar_ember: { grants: [{ id: 42 }, { id: 'ok', resets_left: 2, usable_now: true }] } },
    });
    expect(d.limites).toEqual([
      {
        genre: 'weekly_all',
        groupe: '',
        pourcent: 3,
        gravite: 'inconnue',
        reinitialiseLe: null,
        modele: null,
        surface: null,
        active: false,
      },
    ]);
    expect(d.reinitialisations?.offres.map((o) => o.id)).toEqual(['ok']);
    expect(d.reinitialisations?.disponibles).toBe(2);
  });

  test('problèmes joints en une ligne ; aucun problème → null', () => {
    const d = lireDetail({ ...vide, problemes: ['usage illisible : HTTP 500', 'crédits prépayés non lus'] });
    expect(d.probleme).toBe('usage illisible : HTTP 500 ; crédits prépayés non lus');
  });
});
