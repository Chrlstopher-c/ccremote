/**
 * Le compteur d'autonomie tient-il la promesse de son propre message de refus ?
 *
 * `☠` DÉFAUT MESURÉ EN PRODUCTION LE 07/08. Le refus de plafond dit à
 * l'orchestrateur « sa prochaine approbation manuelle relance le compteur ».
 * C'était faux : le comptage partait de `autonomieDebut`, qu'une approbation
 * humaine ne déplace pas. Après 40 équipes, `autoApprouveesDeja` restait à 40
 * quoi que fasse Chris — le fil était mort définitivement, et `mon_autonomie`
 * continuait d'annoncer le mur.
 *
 * Ce test ne vérifie PAS la fonction pure isolément : il passe par un registre
 * SQLite réel, trancher() compris, parce que le défaut vivait précisément dans
 * ce que le registre était interrogé de rendre — pas dans l'arithmétique.
 */

import { describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { deciderAutorisation, seuilComptageAutonomie } from './index.ts';

const CONV = 'conv-autonomie';
const PLAFOND = 3;

function registreJetable(): Registre {
  return ouvrirRegistre({ chemin: ':memory:' });
}

/** Un mandat proposé puis tranché, à un instant précis — l'unité du compteur. */
function mandatTranche(registre: Registre, id: string, origine: 'auto' | 'humain', quand: number): void {
  registre.propositions.creer({
    id,
    conversationId: CONV,
    projet: '/tmp/projet-fictif',
    objectif: `objectif ${id}`,
    critereArret: null,
    perimetre: 'test',
    budgetMaxUsd: 1,
  });
  registre.propositions.trancher(id, 'approuvee', null, null, quand, origine);
}

/** Ce que la composition calcule réellement avant de décider (assembler-control-plane). */
function decisionCourante(registre: Registre, maintenant: number): ReturnType<typeof deciderAutorisation> {
  const conv = registre.conversations.lire(CONV);
  const seuil = seuilComptageAutonomie(
    conv?.autonomieDebut ?? null,
    registre.propositions.dateDerniereApprobationHumaine(CONV),
  );
  return deciderAutorisation({
    approbationHumaineAnterieure: registre.propositions.aApprobationHumaine(CONV),
    autoApprouveesDeja: registre.propositions.compterAutoApprouvees(CONV, seuil),
    fenetreDebut: conv?.autonomieDebut ?? null,
    fenetreFin: conv?.autonomieFin ?? null,
    maintenant,
    plafond: PLAFOND,
  });
}

describe("une approbation humaine rouvre l'autonomie du fil", () => {
  test('☠ le mur atteint, un clic de Chris relance réellement le compteur', () => {
    const registre = registreJetable();
    registre.conversations.creer({ id: CONV, titre: 'fil de test' }, 1_000);

    // Le clic fondateur : c'est lui qui engage le fil (H-61 déplacé).
    mandatTranche(registre, 'p-humain-1', 'humain', 2_000);

    // Puis le fil consomme tout son plafond, seul.
    mandatTranche(registre, 'p-auto-1', 'auto', 3_000);
    mandatTranche(registre, 'p-auto-2', 'auto', 4_000);
    mandatTranche(registre, 'p-auto-3', 'auto', 5_000);

    const auMur = decisionCourante(registre, 6_000);
    expect(auMur.mode).toBe('humain');
    expect(auMur.raison).toContain("plafond d'autonomie atteint");
    // Le message promet la relance : le reste du test vérifie qu'il ne ment pas.
    expect(auMur.raison).toContain('relance le compteur');

    // Chris approuve un mandat à la main, APRÈS le mur.
    mandatTranche(registre, 'p-humain-2', 'humain', 7_000);

    const apresClic = decisionCourante(registre, 8_000);
    expect(apresClic.mode).toBe('auto');
    // Le compteur repart de zéro : la première équipe d'après le clic est la 1re.
    expect(apresClic.raison).toContain(`(1/${PLAFOND})`);
  });

  test('le clic ne relance QUE ce qui le suit — les mandats postérieurs comptent à nouveau', () => {
    const registre = registreJetable();
    registre.conversations.creer({ id: CONV, titre: 'fil de test' }, 1_000);
    mandatTranche(registre, 'p-humain-1', 'humain', 2_000);
    mandatTranche(registre, 'p-auto-1', 'auto', 3_000);
    mandatTranche(registre, 'p-auto-2', 'auto', 4_000);
    mandatTranche(registre, 'p-auto-3', 'auto', 5_000);
    mandatTranche(registre, 'p-humain-2', 'humain', 6_000);

    // Deux équipes reparties seules après le clic : le plafond de 3 tient encore.
    mandatTranche(registre, 'p-auto-4', 'auto', 7_000);
    mandatTranche(registre, 'p-auto-5', 'auto', 8_000);
    expect(decisionCourante(registre, 9_000).mode).toBe('auto');

    // La troisième d'après-clic sature de nouveau : l'autonomie est rouverte,
    // pas supprimée. Sans ce cas, la correction pourrait n'être qu'un plafond ôté.
    mandatTranche(registre, 'p-auto-6', 'auto', 10_000);
    const reMur = decisionCourante(registre, 11_000);
    expect(reMur.mode).toBe('humain');
    expect(reMur.raison).toContain(`(${PLAFOND}/${PLAFOND} équipes lancées sans clic)`);
  });

  test('sans aucun clic humain, le seuil reste à zéro — le plafond compte toute la vie du fil', () => {
    expect(seuilComptageAutonomie(null, null)).toBe(0);
    // Le jalon le plus tardif gagne : une fenêtre ouverte après le dernier clic
    // ne ressuscite pas des auto-approbations que ce clic venait de solder.
    expect(seuilComptageAutonomie(5_000, 2_000)).toBe(5_000);
    expect(seuilComptageAutonomie(2_000, 5_000)).toBe(5_000);
  });
});
