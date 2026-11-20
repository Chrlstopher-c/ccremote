// Responsabilité : tests du contrat du service de dictée (état d'un poste, action, réglage) et des commandes relais
// qui le portent — les bornes (0 à 1440 min), les états connus, la forme des corps.
import { describe, expect, test } from 'bun:test';
import { CommandeRelais } from './protocole-poste.ts';
import { CorpsDictee, GENRES_RESTE_LOT2 } from './reste-lot2.ts';
import { CorpsServiceDictee, EtatServiceDicteePoste, ServiceDictee } from './dictee-service.ts';

const ETAT = {
  installe: true,
  etat: 'pret',
  depuis: '2026-11-20T10:00:00Z',
  chargementMs: 1200,
  memoireGpuMo: 4096,
  latenceMs: null,
  derniereActivite: null,
  arretInactiviteMin: 15,
  lanceParPoste: true,
  message: null,
};

describe('état du service de dictée', () => {
  test('un état complet est accepté', () => {
    expect(EtatServiceDicteePoste.safeParse(ETAT).success).toBe(true);
  });

  test('état inconnu refusé ; durée d’arrêt hors 0–1440 refusée', () => {
    expect(EtatServiceDicteePoste.safeParse({ ...ETAT, etat: 'chauffe' }).success).toBe(false);
    expect(EtatServiceDicteePoste.safeParse({ ...ETAT, arretInactiviteMin: 1441 }).success).toBe(false);
    expect(EtatServiceDicteePoste.safeParse({ ...ETAT, arretInactiviteMin: -1 }).success).toBe(false);
    expect(EtatServiceDicteePoste.safeParse({ ...ETAT, arretInactiviteMin: 0 }).success).toBe(true);
  });

  test('le parc : chaque machine porte son nom', () => {
    expect(ServiceDictee.safeParse({ machines: [{ ...ETAT, machine: 'tour' }] }).success).toBe(true);
    expect(ServiceDictee.safeParse({ machines: [ETAT] }).success).toBe(false);
  });
});

describe('corps de l’action', () => {
  test('démarrer, arrêter, régler avec durée', () => {
    expect(CorpsServiceDictee.safeParse({ action: 'demarrer' }).success).toBe(true);
    expect(CorpsServiceDictee.safeParse({ action: 'regler', arretInactiviteMin: 30 }).success).toBe(true);
    expect(CorpsServiceDictee.safeParse({ action: 'supprimer' }).success).toBe(false);
  });

  test('la dictée accepte une machine nommée, optionnelle', () => {
    expect(CorpsDictee.safeParse({ pcm16: 'AAAA', machine: 'tour' }).success).toBe(true);
    expect(CorpsDictee.safeParse({ pcm16: 'AAAA' }).success).toBe(true);
    expect(CorpsDictee.safeParse({ pcm16: 'AAAA', machine: '' }).success).toBe(false);
  });
});

describe('commandes relais du service', () => {
  test('référencées dans le genre du lot 2', () => {
    expect(GENRES_RESTE_LOT2).toContain('dictee_service_etat');
    expect(GENRES_RESTE_LOT2).toContain('dictee_service');
  });

  test('action validée côté poste comme côté relais', () => {
    expect(CommandeRelais.safeParse({ kind: 'dictee_service_etat', id: 'c1' }).success).toBe(true);
    expect(
      CommandeRelais.safeParse({ kind: 'dictee_service', id: 'c2', action: 'regler', arretInactiviteMin: 30 }).success,
    ).toBe(true);
    expect(
      CommandeRelais.safeParse({ kind: 'dictee_service', id: 'c3', action: 'regler', arretInactiviteMin: 9999 })
        .success,
    ).toBe(false);
  });
});
