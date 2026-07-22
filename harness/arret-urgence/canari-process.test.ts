/**
 * `PortDrillCanariProcess` — canari RÉEL du drill d'arrêt d'urgence (dette n°2).
 *
 * Ces tests démarrent un vrai process (`sleep`) et constatent sa mort par
 * lecture de `/proc`, jamais en se fiant au seul retour de `kill()`. Aucun
 * mock du système de fichiers ou de process ici : c'est précisément ce que
 * la mission interdit de simuler.
 */

import { access } from 'node:fs/promises';
import { afterEach, describe, expect, test } from 'bun:test';
import { PortDrillCanariProcess } from './canari-process.ts';
import { VerificateurDrillArretUrgence } from './exercice-periodique.ts';
import { ETAPE_PREUVE_COMPLETE } from './types.ts';

async function procVivant(pid: number): Promise<boolean> {
  try {
    await access(`/proc/${pid}`);
    return true;
  } catch {
    return false;
  }
}

function extraitPid(sessionId: string): number {
  const pid = Number(sessionId.replace('pid-', ''));
  if (Number.isNaN(pid)) throw new Error(`sessionId inattendu : ${sessionId}`);
  return pid;
}

describe('PortDrillCanariProcess — cible réelle, mort constatée par /proc', () => {
  let canariCourant: PortDrillCanariProcess | null = null;

  afterEach(async () => {
    await canariCourant?.fermer();
    canariCourant = null;
  });

  test('demarrerCanari() lance un vrai process, vivant dans /proc', async () => {
    const canari = new PortDrillCanariProcess();
    canariCourant = canari;
    const missionId = await canari.demarrerCanari();

    expect(missionId).toMatch(/^canari-arret-urgence-/);
    const pid = canari.pidCanariActuel();
    expect(pid).not.toBeNull();
    expect(await procVivant(pid!)).toBe(true);
  });

  test('arreterMissionEnUrgence() sur le bon missionId tue réellement le canari et le constate', async () => {
    const canari = new PortDrillCanariProcess({ timeoutConstatMortMs: 2000 });
    canariCourant = canari;
    const missionId = await canari.demarrerCanari();

    const resultat = await canari.arreterMissionEnUrgence(missionId, 20);
    expect(resultat).not.toBeNull();
    const pid = extraitPid(resultat!.sessionId);

    // Preuve réelle : /proc/<pid> n'existe plus (pas seulement "kill() n'a pas levé").
    expect(await procVivant(pid)).toBe(false);
    expect(resultat!.etapes).toContain('fermeture_propre');
    expect(resultat!.etapes).toContain(ETAPE_PREUVE_COMPLETE);
  });

  test('un missionId qui ne correspond pas au canari en cours retourne null — isolation structurelle', async () => {
    const canari = new PortDrillCanariProcess();
    canariCourant = canari;
    await canari.demarrerCanari();

    const resultat = await canari.arreterMissionEnUrgence('mission-reelle-en-production-42', 20);
    expect(resultat).toBeNull();
  });

  test('missionId d’un canari déjà arrêté ne matche plus rien (pas de double-forçage sur PID recyclé)', async () => {
    const canari = new PortDrillCanariProcess({ timeoutConstatMortMs: 2000 });
    canariCourant = canari;
    const missionId = await canari.demarrerCanari();
    await canari.arreterMissionEnUrgence(missionId, 20);

    const second = await canari.arreterMissionEnUrgence(missionId, 20);
    expect(second).toBeNull();
  });

  test('demarrerCanari() appelé deux fois nettoie le premier canari (pas de fuite de process)', async () => {
    const canari = new PortDrillCanariProcess({ timeoutConstatMortMs: 2000 });
    canariCourant = canari;
    const premierId = await canari.demarrerCanari();
    const premierResultat = await canari.arreterMissionEnUrgence(premierId, 1);
    const premierPid = extraitPid(premierResultat!.sessionId);

    const secondId = await canari.demarrerCanari();
    expect(secondId).not.toBe(premierId);

    // Le premier reste bien mort (pas ressuscité par le second démarrage).
    expect(await procVivant(premierPid)).toBe(false);

    await canari.demarrerCanari(); // relance encore : doit nettoyer le second sans lever
  });

  test('fermer() tue un canari jamais arrêté explicitement (teardown, cas orphelin)', async () => {
    const canari = new PortDrillCanariProcess({ timeoutConstatMortMs: 2000 });
    const missionId = await canari.demarrerCanari();
    const pid = canari.pidCanariActuel();
    expect(await procVivant(pid!)).toBe(true);

    await canari.fermer();
    expect(await procVivant(pid!)).toBe(false);

    const nouveauId = await canari.demarrerCanari();
    expect(nouveauId).not.toBe(missionId);
    canariCourant = canari;
  });
});

describe('Intégration réelle avec le scheduler de drill (VerificateurDrillArretUrgence)', () => {
  test('un tick du drill exerce le vrai canari de bout en bout et le tue réellement', async () => {
    const canari = new PortDrillCanariProcess({ timeoutConstatMortMs: 2000 });
    const missionId = await canari.demarrerCanari();

    const verificateur = new VerificateurDrillArretUrgence({
      port: canari,
      missionIdCanari: missionId,
      graceMs: 20,
      planifier: () => ({ annuler: () => {} }), // jamais de vrai setInterval en test
    });

    await verificateur.executerMaintenant();

    expect(verificateur.etat().dernierSuccesA).not.toBeNull();
    expect(verificateur.etat().dernierEchec).toBeNull();

    await canari.fermer();
  });

  test('un second tick sur le même canari déjà mort déclenche "cible_absente", pas un faux succès', async () => {
    const canari = new PortDrillCanariProcess({ timeoutConstatMortMs: 2000 });
    const missionId = await canari.demarrerCanari();

    const verificateur = new VerificateurDrillArretUrgence({
      port: canari,
      missionIdCanari: missionId,
      graceMs: 20,
      planifier: () => ({ annuler: () => {} }),
    });

    await verificateur.executerMaintenant(); // tue le canari
    await verificateur.executerMaintenant(); // le canari n'est plus enregistré : cible absente

    expect(verificateur.etat().dernierEchec).not.toBeNull();
    expect(verificateur.etat().dernierEchec?.motif).toContain('introuvable');

    await canari.fermer();
  });
});
