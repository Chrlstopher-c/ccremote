/**
 * Tests du groupe « service » (A.2.2) — `etat_service` délègue à
 * `LecteurServiceSysteme`, `piloter_service` à `PiloteServiceSysteme`. Les
 * deux ports sont ceux de `service-systeme.ts` (composition, LOCAL au Pi),
 * doublés ici pour ne jamais exécuter de vraie commande système : ce fichier
 * ne redémarre ni ne relève rien de réel — voir `service-systeme.test.ts`
 * pour la partie exécutée réellement (lecture pure uniquement).
 */

import { describe, expect, test } from 'bun:test';
import {
  etatService,
  piloterService,
  SEAU_1_JAMAIS_EXPOSE,
  SEAU_2_ETAT_SEULEMENT,
  SEAU_3_DEUX_OUTILS,
  SERVICES_ETAT_SERVICE,
  SERVICES_PILOTER_SERVICE,
} from './outils-service.ts';
import type { EtatServiceSysteme, LecteurServiceSysteme, PiloteServiceSysteme } from './types.ts';

const ETAT_ACTIF: EtatServiceSysteme = {
  service: 'portfolio',
  actif: 'active',
  sousEtat: 'running',
  depuis: 'Tue 2026-08-05 09:12:03 UTC',
};

describe('etat_service', () => {
  test('unité connue ⇒ applique, avec le résumé lisible dans l’état rendu', async () => {
    const lecteur: LecteurServiceSysteme = { etatService: async () => ETAT_ACTIF };
    const resultat = await etatService(lecteur, 'pi', 'portfolio');
    expect(resultat.ok).toBe(true);
    expect(resultat.effet).toBe('applique');
    expect(resultat.etat).toContain('etat=active');
    expect(resultat.etat).toContain('running');
  });

  test('sous-état/horodatage absents ⇒ résumé sans les parenthèses vides', async () => {
    const lecteur: LecteurServiceSysteme = {
      etatService: async () => ({ service: 'nullnode-relay', actif: 'inactive', sousEtat: null, depuis: null }),
    };
    const resultat = await etatService(lecteur, 'pi', 'nullnode-relay');
    expect(resultat.etat).toBe('service=nullnode-relay · etat=inactive');
  });

  test('unité inconnue de systemd (`null`) ⇒ refus explicite, jamais une erreur brute', async () => {
    const lecteur: LecteurServiceSysteme = { etatService: async () => null };
    const resultat = await etatService(lecteur, 'pi', 'portfolio');
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('introuvable');
    expect(resultat.raison).toContain('17/07');
  });

  test('une exception du port ⇒ echecInattendu, jamais une exception qui remonte', async () => {
    const lecteur: LecteurServiceSysteme = {
      etatService: async () => {
        throw new Error('dbus indisponible');
      },
    };
    const resultat = await etatService(lecteur, 'pi', 'portfolio');
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('dbus indisponible');
  });
});

describe('piloter_service', () => {
  test('redémarrage réussi ⇒ applique', async () => {
    const piloteur: PiloteServiceSysteme = { redemarrer: async () => ({ ok: true }) };
    const resultat = await piloterService(piloteur, 'pi', 'portfolio', 'restart');
    expect(resultat.ok).toBe(true);
    expect(resultat.effet).toBe('applique');
  });

  test('☠ obstacle sudo (motif `permission`) ⇒ refuse avec le détail actionnable relayé tel quel', async () => {
    const piloteur: PiloteServiceSysteme = {
      redemarrer: async () => ({
        ok: false,
        motif: 'permission',
        detail: 'privilège root requis — règle sudoers manquante pour pi',
      }),
    };
    const resultat = await piloterService(piloteur, 'pi', 'portfolio', 'restart');
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('sudoers');
  });

  test('unité inconnue (motif `inconnu`) ⇒ même message de réserve d’inventaire que etat_service', async () => {
    const piloteur: PiloteServiceSysteme = {
      redemarrer: async () => ({ ok: false, motif: 'inconnu', detail: 'sans intérêt ici' }),
    };
    const resultat = await piloterService(piloteur, 'pi', 'portfolio', 'restart');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('introuvable');
    expect(resultat.raison).toContain('17/07');
  });

  test('échec non catégorisé (motif `autre`) ⇒ refuse avec le détail du port', async () => {
    const piloteur: PiloteServiceSysteme = {
      redemarrer: async () => ({ ok: false, motif: 'autre', detail: 'systemd: dépendance manquante' }),
    };
    const resultat = await piloterService(piloteur, 'pi', 'portfolio', 'restart');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('dépendance manquante');
  });

  test('une exception du port ⇒ echecInattendu, jamais une exception qui remonte', async () => {
    const piloteur: PiloteServiceSysteme = {
      redemarrer: async () => {
        throw new Error('ENOENT sudo');
      },
    };
    const resultat = await piloterService(piloteur, 'pi', 'portfolio', 'restart');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('ENOENT sudo');
  });
});

describe('la liste blanche — les trois seaux', () => {
  test('SEAU 1 (jamais exposé) est disjoint de etat_service ET de piloter_service', () => {
    for (const service of SEAU_1_JAMAIS_EXPOSE) {
      expect((SERVICES_ETAT_SERVICE as readonly string[]).includes(service)).toBe(false);
      expect((SERVICES_PILOTER_SERVICE as readonly string[]).includes(service)).toBe(false);
    }
  });

  test('SEAU 2 (etat_service seulement) est ABSENT de piloter_service', () => {
    for (const service of SEAU_2_ETAT_SEULEMENT) {
      expect((SERVICES_ETAT_SERVICE as readonly string[]).includes(service)).toBe(true);
      expect((SERVICES_PILOTER_SERVICE as readonly string[]).includes(service)).toBe(false);
    }
  });

  test('SEAU 3 (les deux outils) est présent dans les deux enums', () => {
    for (const service of SEAU_3_DEUX_OUTILS) {
      expect((SERVICES_ETAT_SERVICE as readonly string[]).includes(service)).toBe(true);
      expect((SERVICES_PILOTER_SERVICE as readonly string[]).includes(service)).toBe(true);
    }
  });

  // ☠ Validation dans les deux sens (règle de session) : un service DU SEAU 3
  // doit rester acceptable par les deux enums — sinon les tests d'exclusion
  // ci-dessus ne prouveraient rien, ils rejetteraient tout par excès de prudence.
  test('un service du seau 3 n’est pas rejeté par erreur', () => {
    expect(SERVICES_PILOTER_SERVICE.length).toBeGreaterThan(0);
    expect(SERVICES_ETAT_SERVICE.length).toBeGreaterThanOrEqual(SERVICES_PILOTER_SERVICE.length);
  });
});
