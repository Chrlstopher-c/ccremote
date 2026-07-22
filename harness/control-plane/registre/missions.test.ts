/**
 * Tests du régime « N missions courtes × rétention » (☠ panne #5), du lot
 * (F2.1.4), du compte par mission (H-53) et des quotas (H-54).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type Registre } from './index.ts';

let repertoire: string;
let registre: Registre;

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'registre-missions-'));
  registre = ouvrirRegistre({ chemin: join(repertoire, 'registre.sqlite') });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-1' });
  registre.comptes.enregistrer({ id: 'compte2', configDir: '/tmp/cc-2' });
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoire, { recursive: true, force: true });
});

function mission(id: string, projet: string, lotId: string, compteId = 'compte1'): void {
  registre.missions.creer({ id, lotId, nom: id, projet, compteId });
}

// ------------------------------------------------- ☠ panne #5 — dimensionnement

describe('☠ panne #5 — régime « N missions courtes × rétention »', () => {
  test('terminee est le cas nominal : le parc actif reste borné malgré l historique', () => {
    registre.lots.creer({ id: 'lot-h', intention: 'travail de la nuit' });
    for (let i = 0; i < 300; i += 1) {
      const id = `m-${i}`;
      mission(id, `projet-${i % 5}`, 'lot-h');
      registre.etats.appliquerEtatHarness(id, 'en_cours');
      registre.etats.appliquerEtatSdk(id, 'running');
      registre.etats.appliquerEtatHarness(id, 'terminee');
    }
    // 300 missions en base, 5 projets, aucune active.
    expect(registre.missions.listerActives()).toHaveLength(0);
    expect(registre.missions.listerParLot('lot-h')).toHaveLength(300);

    // On peut immédiatement relancer sur chaque projet : rien n'est resté « occupé ».
    for (let p = 0; p < 5; p += 1) mission(`n-${p}`, `projet-${p}`, 'lot-h');
    expect(registre.missions.listerActives()).toHaveLength(5);
  });

  test('la purge par ancienneté retire les missions closes et leur historique', () => {
    registre.lots.creer({ id: 'lot-r', intention: 'ancien' });
    mission('vieille', 'projet-a', 'lot-r');
    registre.etats.appliquerEtatHarness('vieille', 'terminee', { maintenant: 1_000 });
    mission('recente', 'projet-b', 'lot-r');
    registre.etats.appliquerEtatHarness('recente', 'terminee', { maintenant: 9_000 });
    mission('active', 'projet-c', 'lot-r');
    registre.etats.appliquerEtatHarness('active', 'en_cours', { maintenant: 500 });

    const supprimees = registre.missions.purgerTermineesAvant(5_000);
    expect(supprimees).toBe(1);
    expect(registre.missions.lire('vieille')).toBeNull();
    expect(registre.etats.historique('vieille')).toHaveLength(0);
    expect(registre.missions.lire('recente')).not.toBeNull();
    // Une mission encore active n'est jamais purgée, quelle que soit son ancienneté.
    expect(registre.missions.lire('active')).not.toBeNull();
  });

  test('une mission terminée puis rouverte perd sa date de fin', () => {
    registre.lots.creer({ id: 'lot-x', intention: 'x' });
    mission('m', 'projet-a', 'lot-x');
    registre.etats.appliquerEtatHarness('m', 'terminee');
    expect(registre.missions.exiger('m').termineeA).not.toBeNull();
    registre.etats.appliquerEtatHarness('m', 'en_cours');
    expect(registre.missions.exiger('m').termineeA).toBeNull();
  });

  test('compterParEtatHarness donne le profil de volume', () => {
    registre.lots.creer({ id: 'lot-c', intention: 'c' });
    mission('a', 'p1', 'lot-c');
    mission('b', 'p2', 'lot-c');
    registre.etats.appliquerEtatHarness('b', 'terminee');
    const compteurs = Object.fromEntries(
      registre.missions.compterParEtatHarness().map((c) => [c.etatHarness, c.nombre]),
    );
    expect(compteurs['planifiee']).toBe(1);
    expect(compteurs['terminee']).toBe(1);
  });
});

// -------------------------------------------------------------------- lots

describe('lot — « où en est ce que j ai demandé hier soir ? »', () => {
  test('un lot agrège ses missions et leur avancement', () => {
    registre.lots.creer({ id: 'lot-1', intention: 'refonte du dashboard', origine: 'telephone' });
    mission('m-a', 'projet-a', 'lot-1');
    mission('m-b', 'projet-b', 'lot-1');
    mission('m-c', 'projet-c', 'lot-1');
    registre.etats.appliquerEtatHarness('m-a', 'terminee');
    registre.etats.appliquerEtatHarness('m-b', 'echec_definitif', {
      raisonTerminale: 'budget_exhausted',
    });

    const avancement = registre.avancementLot('lot-1');
    expect(avancement).not.toBeNull();
    expect(avancement?.lot.intention).toBe('refonte du dashboard');
    expect(avancement?.total).toBe(3);
    expect(avancement?.terminees).toBe(1);
    expect(avancement?.echecs).toBe(1);
    expect(avancement?.actives).toBe(1);
    expect(registre.missions.exiger('m-b').derniereRaisonTerminale).toBe('budget_exhausted');
  });

  test('la structure de lot supporte plusieurs missions même si la v1 n en met qu une', () => {
    registre.lots.creer({ id: 'lot-multi', intention: 'intention unique' });
    mission('m-1', 'projet-1', 'lot-multi');
    mission('m-2', 'projet-2', 'lot-multi');
    expect(registre.missions.listerParLot('lot-multi')).toHaveLength(2);
  });

  test('clore un lot est idempotent', () => {
    registre.lots.creer({ id: 'lot-f', intention: 'f' });
    expect(registre.lots.clore('lot-f')).toBe(true);
    expect(registre.lots.clore('lot-f')).toBe(false);
    expect(registre.lots.listerOuverts()).toHaveLength(0);
  });
});

// ------------------------------------------------------------ H-56 / fencing

describe('invariants de mission', () => {
  test('H-56 — deux missions actives sur le même projet sont refusées par le schéma', () => {
    registre.lots.creer({ id: 'lot-1', intention: 'i' });
    mission('m-1', 'projet-alpha', 'lot-1');
    expect(() => mission('m-2', 'projet-alpha', 'lot-1')).toThrow();
  });

  test('H-56 — le projet se libère dès que la mission est terminée', () => {
    registre.lots.creer({ id: 'lot-1', intention: 'i' });
    mission('m-1', 'projet-alpha', 'lot-1');
    registre.etats.appliquerEtatHarness('m-1', 'terminee');
    expect(() => mission('m-2', 'projet-alpha', 'lot-1')).not.toThrow();
    expect(registre.missions.lireActiveDuProjet('projet-alpha')?.id).toBe('m-2');
  });

  test('le high-water mark est strictement monotone', () => {
    registre.lots.creer({ id: 'lot-1', intention: 'i' });
    mission('m-1', 'projet-alpha', 'lot-1');
    expect(registre.missions.avancerHighWaterMark('m-1', 10)).toBe(10);
    expect(registre.missions.avancerHighWaterMark('m-1', 4)).toBe(10);
    expect(registre.missions.avancerHighWaterMark('m-1', 11)).toBe(11);
  });

  test('l epoch de fencing s incrémente', () => {
    registre.lots.creer({ id: 'lot-1', intention: 'i' });
    mission('m-1', 'projet-alpha', 'lot-1');
    expect(registre.missions.exiger('m-1').epoch).toBe(0);
    expect(registre.missions.incrementerEpoch('m-1')).toBe(1);
    expect(registre.missions.incrementerEpoch('m-1')).toBe(2);
  });

  test('une mission référence un compte existant, et lui seul', () => {
    registre.lots.creer({ id: 'lot-1', intention: 'i' });
    expect(() => mission('m-1', 'projet-alpha', 'lot-1', 'compte-inconnu')).toThrow();
  });
});

// ------------------------------------------------------- H-53 / H-54 comptes

describe('comptes et quotas', () => {
  test('H-53 — le compte utilisé est attribué par mission', () => {
    registre.lots.creer({ id: 'lot-1', intention: 'i' });
    mission('m-1', 'projet-a', 'lot-1', 'compte1');
    mission('m-2', 'projet-b', 'lot-1', 'compte2');
    registre.missions.ajouterCout('m-1', 2);
    registre.missions.ajouterCout('m-2', 3);
    expect(registre.missions.exiger('m-1').compteId).toBe('compte1');
    expect(registre.missions.exiger('m-2').compteId).toBe('compte2');
  });

  test('H-54 — un relevé sans utilisation n écrase pas une utilisation connue', () => {
    registre.comptes.releverQuota({
      compteId: 'compte1',
      typeFenetre: 'five_hour',
      statut: 'allowed',
      utilisation: 37.5,
      observeA: 1_000,
    });
    registre.comptes.releverQuota({
      compteId: 'compte1',
      typeFenetre: 'five_hour',
      statut: 'allowed_warning',
      observeA: 2_000,
    });
    const quota = registre.comptes.lireQuota('compte1', 'five_hour');
    expect(quota?.statut).toBe('allowed_warning');
    expect(quota?.utilisation).toBe(37.5);
    expect(quota?.observeA).toBe(2_000);
  });

  test('H-53 — un compte saturé sort des comptes disponibles', () => {
    registre.comptes.releverQuota({
      compteId: 'compte1',
      typeFenetre: 'seven_day',
      statut: 'rejected',
    });
    expect(registre.comptes.listerDisponibles().map((c) => c.id)).toEqual(['compte2']);
  });

  test('les fenêtres de quota coexistent par compte', () => {
    registre.comptes.releverQuota({
      compteId: 'compte1',
      typeFenetre: 'five_hour',
      statut: 'allowed',
    });
    registre.comptes.releverQuota({
      compteId: 'compte1',
      typeFenetre: 'seven_day_opus',
      statut: 'allowed_warning',
    });
    expect(registre.comptes.listerQuotas('compte1')).toHaveLength(2);
  });
});

// ------------------------------------------------------------------ E.5

describe('capacités par mission (E.5)', () => {
  test('jamais observée se distingue d observée absente', () => {
    registre.lots.creer({ id: 'lot-1', intention: 'i' });
    mission('m-1', 'projet-a', 'lot-1');
    expect(registre.capacites.estPresente('m-1', 'reinitialize')).toBeNull();
    registre.capacites.enregistrer('m-1', { reinitialize: false });
    expect(registre.capacites.estPresente('m-1', 'reinitialize')).toBe(false);
    expect(registre.capacites.manquantesSurveillees('m-1')).toEqual(['reinitialize']);
  });

  test('un parc hétérogène est représentable', () => {
    registre.lots.creer({ id: 'lot-1', intention: 'i' });
    mission('m-1', 'projet-a', 'lot-1');
    mission('m-2', 'projet-b', 'lot-1');
    registre.capacites.enregistrer('m-1', { interrupt_receipt_v1: true });
    registre.capacites.enregistrer('m-2', { interrupt_receipt_v1: false });
    expect(registre.capacites.manquantesSurveillees('m-1')).toHaveLength(0);
    expect(registre.capacites.manquantesSurveillees('m-2')).toEqual(['interrupt_receipt_v1']);
  });
});
