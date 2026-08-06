/**
 * `☠` `lireEtatService` est testé contre de VRAIS appels `systemctl` locaux —
 * même patron que `etat-git.test.ts` (lecture seule, jamais de doublure) :
 * c'est une lecture système inoffensive, exécutable sur n'importe quelle
 * machine Linux avec systemd, pas seulement le Pi. `interpreterEchecRedemarrage`
 * est en revanche testé PURE, sans exécuter aucune commande : ce fichier
 * n'appelle et n'appellera JAMAIS `redemarrerService` (interdit de mission —
 * aucun redémarrage, même sur une unité fictive, même en test).
 */

import { describe, expect, test } from 'bun:test';
import { lireEtatService, interpreterEchecRedemarrage } from './service-systeme.ts';

describe('lireEtatService — lecture systemd réelle, jamais de doublure', () => {
  test('unité connue et active (systemd-journald) ⇒ état lu, jamais `null`', async () => {
    const etat = await lireEtatService('systemd-journald.service');
    expect(etat).not.toBeNull();
    expect(etat?.actif).toBe('active');
    expect(etat?.service).toBe('systemd-journald.service');
  });

  test('☠ unité inconnue de systemd ⇒ `null`, JAMAIS un objet inventé — c’est ce que `outils-service.ts` traduit en refus', async () => {
    const etat = await lireEtatService('ccremote-unite-qui-nexiste-nulle-part.service');
    expect(etat).toBeNull();
  });
});

describe('interpreterEchecRedemarrage — pur, AUCUNE commande exécutée', () => {
  test('☠ « sudo -n » sans règle NOPASSWD ⇒ motif `permission`, détail nommant la règle sudoers exacte', () => {
    const erreur = Object.assign(new Error('Command failed'), {
      stdout: '',
      stderr: 'sudo: a password is required\n',
    });
    const resultat = interpreterEchecRedemarrage('portfolio.service', erreur);
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) {
      expect(resultat.motif).toBe('permission');
      expect(resultat.detail).toContain('sudoers');
      expect(resultat.detail).toContain('NOPASSWD');
      expect(resultat.detail).toContain('portfolio.service');
    }
  });

  test('refus polkit direct (« Interactive authentication required ») ⇒ motif `permission` également', () => {
    const erreur = Object.assign(new Error('Command failed'), {
      stdout: '',
      stderr: '==== AUTHENTICATING FOR org.freedesktop.systemd1.manage-units ===\nInteractive authentication required.\n',
    });
    const resultat = interpreterEchecRedemarrage('nullnode-relay.service', erreur);
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.motif).toBe('permission');
  });

  test('unité inconnue de systemd (au moment du restart) ⇒ motif `inconnu`', () => {
    const erreur = Object.assign(new Error('Command failed'), {
      stdout: '',
      stderr: 'Unit ccremote-inconnu.service not found.\n',
    });
    const resultat = interpreterEchecRedemarrage('ccremote-inconnu.service', erreur);
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.motif).toBe('inconnu');
  });

  test('échec non catégorisé ⇒ motif `autre`, détail relayé (jamais avalé)', () => {
    const erreur = Object.assign(new Error('Command failed'), {
      stdout: '',
      stderr: 'Job for portfolio.service failed because the control process exited with error code.\n',
    });
    const resultat = interpreterEchecRedemarrage('portfolio.service', erreur);
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) {
      expect(resultat.motif).toBe('autre');
      expect(resultat.detail).toContain('control process');
    }
  });

  // ☠ Validation dans les deux sens : un succès (ok: true) n'est jamais produit
  // par cette fonction — elle n'existe que pour catégoriser un ÉCHEC. Un appel
  // qui réussit ne passe jamais par elle (voir `redemarrerService`).
  test('sans mot-clé reconnu dans stderr/stdout/message ⇒ retombe sur `autre`, jamais un motif inventé', () => {
    const resultat = interpreterEchecRedemarrage('portfolio.service', new Error('erreur totalement inattendue'));
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.motif).toBe('autre');
  });
});
