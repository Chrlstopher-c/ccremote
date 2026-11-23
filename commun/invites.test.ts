// Responsabilité : tests des réglages d'invité — familles, efforts, parts, machines, gestes permis, télémétrie.
import { describe, expect, test } from 'bun:test';
import {
  ActiviteInvite,
  type AccesInvite,
  effortApplique,
  familleDe,
  fusionnerActivites,
  gesteInvitePermis,
  modeleParDefaut,
  type EtatOuverture,
  ReglagesInvite,
  reglagesParDefaut,
  verifierOuverture,
  verifierPart,
} from './invites.ts';

const MACHINE = 'aaaaaaaaaaaa';
const AUTRE = 'bbbbbbbbbbbb';
const SANS_ACCES: AccesInvite = {
  remoteControl: false,
  terminaux: false,
  sessionsAutres: false,
  modules: false,
  fichiersHors: false,
};

function etat(surcharge: Partial<EtatOuverture> = {}): EtatOuverture {
  return {
    machine: MACHINE,
    machineInvite: AUTRE,
    modele: null,
    effort: null,
    sessionsEnCours: 0,
    consomme5h: 0,
    consommeSemaine: 0,
    compteSurSaMachine: false,
    ...surcharge,
  };
}

function activite(surcharge: Partial<ActiviteInvite> = {}): ActiviteInvite {
  return {
    actifAujourdhui: false,
    derniere: null,
    sessionsAujourdhui: 0,
    sessionsEnCours: 0,
    jetonsAujourdhui: 0,
    requetesAujourdhui: 0,
    dernierModele: null,
    part5h: null,
    semaine: null,
    ...surcharge,
  };
}

describe('familles et réglages par défaut', () => {
  test('la famille se lit dans le nom du modèle, sans casse', () => {
    expect(familleDe('claude-sonnet-4-5')).toBe('sonnet');
    expect(familleDe('opus')).toBe('opus');
    expect(familleDe('Claude-HAIKU-5')).toBe('haiku');
    expect(familleDe('inconnu')).toBeNull();
  });

  test('défauts : haiku et sonnet jusqu à high, parts 25 %, deux sessions, la machine seule', () => {
    const r = reglagesParDefaut(MACHINE);
    expect(r.modeles).toEqual({ haiku: ['low', 'medium', 'high'], sonnet: ['low', 'medium', 'high'] });
    expect([r.part5h, r.partSemaine, r.simultanees]).toEqual([25, 25, 2]);
    expect(r.machines).toEqual([MACHINE]);
    expect(reglagesParDefaut(null).machines).toEqual([]);
    expect(r.acces).toEqual(SANS_ACCES);
    expect(ReglagesInvite.safeParse(r).success).toBe(true);
  });

  test('un effort en double dans une famille est refusé à la lecture', () => {
    const r = { ...reglagesParDefaut(MACHINE), modeles: { haiku: ['low', 'low'] } };
    expect(ReglagesInvite.safeParse(r).success).toBe(false);
  });
});

describe('modèles et efforts', () => {
  const r = reglagesParDefaut(MACHINE);

  test('modèle interdit : famille absente, modèle inconnu, liste vide', () => {
    expect(effortApplique(r, 'claude-opus-4', null)).toEqual({ ok: false, raison: 'modèle non permis : opus' });
    expect(effortApplique(r, 'inconnu', null)).toEqual({ ok: false, raison: 'modèle non permis : inconnu' });
    const vide = { ...r, modeles: { haiku: [] } };
    expect(effortApplique(vide, 'haiku', null)).toEqual({ ok: false, raison: 'modèle non permis : haiku' });
  });

  test('effort absent : le plus élevé permis ; effort interdit refusé ; effort permis accepté', () => {
    expect(effortApplique(r, 'sonnet', null)).toEqual({ ok: true, effort: 'high' });
    expect(effortApplique(r, 'sonnet', 'max')).toEqual({ ok: false, raison: 'effort non permis : max' });
    expect(effortApplique(r, 'haiku', 'low')).toEqual({ ok: true, effort: 'low' });
  });

  test('modèle par défaut : sonnet si permis, sinon la première famille permise, sinon null', () => {
    expect(modeleParDefaut(r)).toBe('sonnet');
    const opusSeul: ReglagesInvite = { ...r, modeles: { opus: ['medium'] } };
    expect(modeleParDefaut(opusSeul)).toBe('opus');
    expect(modeleParDefaut({ ...r, modeles: {} })).toBeNull();
  });
});

describe('parts de limite', () => {
  const r = reglagesParDefaut(MACHINE);

  test('consommation sous la part : permis ; atteinte : refusé ; inconnue : permis', () => {
    expect(verifierPart(r, 24, 24)).toEqual({ ok: true });
    expect(verifierPart(r, 25, 0)).toEqual({ ok: false, raison: 'part de la limite de 5 h atteinte' });
    expect(verifierPart(r, 0, 25)).toEqual({ ok: false, raison: 'part hebdomadaire atteinte' });
    expect(verifierPart(r, null, null)).toEqual({ ok: true });
  });

  test('part à 0 : tout refusé, même sans consommation connue ; semaine null : pas de plafond', () => {
    expect(verifierPart({ ...r, part5h: 0 }, null, null).ok).toBe(false);
    expect(verifierPart({ ...r, partSemaine: null }, 0, 999)).toEqual({ ok: true });
  });
});

describe('ouverture d une session', () => {
  const r = reglagesParDefaut(MACHINE);

  test('machine du chef permise, défauts : ouverture en sonnet au plus haut effort permis', () => {
    expect(verifierOuverture(r, etat())).toEqual({ ok: true, modele: 'sonnet', effort: 'high' });
  });

  test('machine non permise refusée', () => {
    expect(verifierOuverture(r, etat({ machine: 'cccccccccccc' }))).toEqual({
      ok: false,
      raison: 'machine non permise',
    });
  });

  test('troisième session simultanée refusée ; deux sessions en cours avec max 3 acceptées', () => {
    expect(verifierOuverture(r, etat({ sessionsEnCours: 2 }))).toEqual({
      ok: false,
      raison: 'trop de sessions simultanées (max 2)',
    });
    expect(verifierOuverture({ ...r, simultanees: 3 }, etat({ sessionsEnCours: 2 })).ok).toBe(true);
  });

  test('part atteinte refusée, avant le modèle', () => {
    expect(verifierOuverture(r, etat({ consomme5h: 30, modele: 'opus' }))).toEqual({
      ok: false,
      raison: 'part de la limite de 5 h atteinte',
    });
  });

  test('modèle interdit et effort interdit refusés ; modèle null prend le modèle par défaut', () => {
    expect(verifierOuverture(r, etat({ modele: 'claude-opus-4' })).ok).toBe(false);
    expect(verifierOuverture(r, etat({ modele: 'sonnet', effort: 'max' }))).toEqual({
      ok: false,
      raison: 'effort non permis : max',
    });
    expect(verifierOuverture({ ...r, modeles: {} }, etat()).ok).toBe(false);
  });

  test('sur sa machine : refusé sans permission, puis sans compte Claude, puis permis', () => {
    const invite = etat({ machine: AUTRE, machineInvite: AUTRE, compteSurSaMachine: true });
    expect(verifierOuverture(r, invite).ok).toBe(false);
    const avec = { ...r, surSaMachine: true };
    expect(verifierOuverture(avec, { ...invite, compteSurSaMachine: false }).ok).toBe(false);
    expect(verifierOuverture(avec, invite).ok).toBe(true);
  });
});

describe('gestes permis', () => {
  test('gestes de la session : listés, sous-ressources de tâches et de fichiers seulement', () => {
    for (const geste of ['evenements', 'messages', 'interrompre', 'modele', 'prompt-systeme', 'taches']) {
      expect(gesteInvitePermis('session', geste, SANS_ACCES)).toBe(true);
    }
    expect(gesteInvitePermis('session', 'taches/abc.1', SANS_ACCES)).toBe(true);
    expect(gesteInvitePermis('session', 'taches/abc.1/arreter', SANS_ACCES)).toBe(true);
    expect(gesteInvitePermis('session', 'fichiers/x_1', SANS_ACCES)).toBe(true);
  });

  test('hors liste blanche, sous-ressource mal formée ou segment piégé : refusé', () => {
    for (const geste of ['mode', 'autonomie', 'nuit', 'ultracode', 'git/status', 'connecteurs', 'dupliquer']) {
      expect(gesteInvitePermis('session', geste, SANS_ACCES)).toBe(false);
    }
    expect(gesteInvitePermis('session', 'taches/..', SANS_ACCES)).toBe(false);
    expect(gesteInvitePermis('session', 'fichiers/a/b', SANS_ACCES)).toBe(false);
    expect(gesteInvitePermis('session', 'taches/a/fin', SANS_ACCES)).toBe(false);
    expect(gesteInvitePermis('session', `taches/${'a'.repeat(161)}`, SANS_ACCES)).toBe(false);
  });

  test('remote-control seulement si la case est cochée ; machine et nœud toujours refusés', () => {
    expect(gesteInvitePermis('session', 'remote-control', SANS_ACCES)).toBe(false);
    expect(gesteInvitePermis('session', 'remote-control', { ...SANS_ACCES, remoteControl: true })).toBe(true);
    expect(gesteInvitePermis('machine', 'evenements', SANS_ACCES)).toBe(false);
    expect(gesteInvitePermis('noeud', 'modele', SANS_ACCES)).toBe(false);
  });
});

describe('activité agrégée', () => {
  test('aucune activité : null ; compteurs sommés ; actif si un des nœuds l est', () => {
    expect(fusionnerActivites([])).toBeNull();
    const fusion = fusionnerActivites([
      activite({ actifAujourdhui: true, sessionsAujourdhui: 2, jetonsAujourdhui: 100 }),
      activite({ sessionsAujourdhui: 1, sessionsEnCours: 1, jetonsAujourdhui: 50 }),
    ]);
    expect(fusion).toMatchObject({
      actifAujourdhui: true,
      sessionsAujourdhui: 3,
      sessionsEnCours: 1,
      jetonsAujourdhui: 150,
    });
  });

  test('derniere : la plus récente ; part : somme des consommés, part et reprise du premier présent', () => {
    const bilan = (consomme: number, part: number, reprise: string | null) => ({ consomme, part, reprise });
    const fusion = fusionnerActivites([
      activite({ derniere: '2026-11-22T09:00:00.000Z', part5h: null }),
      activite({ derniere: '2026-11-22T11:00:00.000Z', part5h: bilan(10, 25, 'demain') }),
      activite({ derniere: '2026-11-22T10:00:00.000Z', part5h: bilan(5, 40, 'plus tard') }),
    ]);
    expect(fusion?.derniere).toBe('2026-11-22T11:00:00.000Z');
    expect(fusion?.part5h).toEqual({ consomme: 15, part: 25, reprise: 'demain' });
    expect(fusion?.semaine).toBeNull();
    expect(ActiviteInvite.safeParse(fusion).success).toBe(true);
  });
});
