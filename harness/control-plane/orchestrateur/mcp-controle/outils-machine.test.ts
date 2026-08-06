/**
 * Tests du groupe « machine » (A.2.2) — `etat_machine` délègue à `metriques_hote`
 * (déjà câblé, voir `metriques-hote.ts`), `reveiller_machine` délègue au réveil
 * Wake-on-LAN (`reveil-wol.ts`, non testable ici sans réseau réel).
 */

import { describe, expect, test } from 'bun:test';
import { etatMachine, reveillerMachine, type EmetteurReveil } from './outils-machine.ts';
import type { LecteurMetriquesHote } from './types.ts';

const METRIQUES_COMPLETES = {
  machine: 'pc',
  cpuPct: 42,
  memUtiliseeMo: 4096,
  memTotaleMo: 16384,
  memPct: 25,
  disqueUtiliseGo: 100,
  disqueTotalGo: 500,
  tempCpuC: 55,
  uptimeS: 7384, // 2h
  reseauMontantKo: 12,
  reseauDescendantKo: 340,
  gpu: { utilPct: 10, memUtiliseeMo: 512, memTotaleMo: 8192, tempC: 60 },
  releveA: Date.now(),
};

describe('etat_machine', () => {
  test('relevé disponible ⇒ applique, avec les chiffres dans l’état rendu', async () => {
    const lecteur: LecteurMetriquesHote = { metriquesHote: async () => METRIQUES_COMPLETES };
    const resultat = await etatMachine(lecteur, 'pc');
    expect(resultat.ok).toBe(true);
    expect(resultat.effet).toBe('applique');
    expect(resultat.etat).toContain('cpu=42%');
    expect(resultat.etat).toContain('temp=55°C');
    expect(resultat.etat).toContain('disque=100/500 Go');
    expect(resultat.etat).toContain('uptime=2h');
  });

  test('GPU absent ⇒ dit « gpu=absent », jamais un chiffre inventé', async () => {
    const lecteur: LecteurMetriquesHote = { metriquesHote: async () => ({ ...METRIQUES_COMPLETES, gpu: null }) };
    const resultat = await etatMachine(lecteur, 'pc');
    expect(resultat.etat).toContain('gpu=absent');
  });

  test('un chiffre `null` se rend `?`, jamais 0 (0 % se lirait comme une mesure réelle)', async () => {
    const lecteur: LecteurMetriquesHote = { metriquesHote: async () => ({ ...METRIQUES_COMPLETES, cpuPct: null }) };
    const resultat = await etatMachine(lecteur, 'pc');
    expect(resultat.etat).toContain('cpu=?%');
    expect(resultat.etat).not.toContain('cpu=0%');
  });

  test('machine hors ligne (relevé `null`) ⇒ refus explicite, jamais un « applique » vide', async () => {
    const lecteur: LecteurMetriquesHote = { metriquesHote: async () => null };
    const resultat = await etatMachine(lecteur, 'pc');
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('pc');
  });

  test('une exception du port ⇒ echecInattendu, jamais une exception qui remonte', async () => {
    const lecteur: LecteurMetriquesHote = {
      metriquesHote: async () => {
        throw new Error('lien rompu');
      },
    };
    const resultat = await etatMachine(lecteur, 'pc');
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('lien rompu');
  });
});

describe('reveiller_machine', () => {
  test('magic packet émis ⇒ accepte (jamais applique : l’allumage n’est pas observable)', async () => {
    const emetteur: EmetteurReveil = { reveiller: async () => {} };
    const resultat = await reveillerMachine(emetteur, 'pc');
    expect(resultat.ok).toBe(true);
    expect(resultat.effet).toBe('accepte');
    expect(resultat.ref).toBe('pc');
  });

  test('échec d’émission (ex. pas de carte réseau) ⇒ echecInattendu, jamais un succès menteur', async () => {
    const emetteur: EmetteurReveil = {
      reveiller: async () => {
        throw new Error('ENETDOWN');
      },
    };
    const resultat = await reveillerMachine(emetteur, 'pc');
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('ENETDOWN');
  });
});
