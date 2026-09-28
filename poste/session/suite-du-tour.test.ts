import { describe, expect, test } from 'bun:test';
import { deciderSuite, type EtatFinDeTour } from './suite-du-tour.ts';

const etat = (e: Partial<EtatFinDeTour> = {}): EtatFinDeTour => ({
  sortDeCompaction: false,
  messagesChrisEnVol: 0,
  objectifAtteint: false,
  questionPosee: false,
  autonomie: true,
  aUnObjectif: true,
  outilsCeTour: 4,
  relancesSansProgres: 0,
  contexte: 50_000,
  maxTokens: 1_000_000,
  etapeTerminee: false,
  compactionDemandee: false,
  sousAgentsActifs: 0,
  ...e,
});

describe('suite du tour', () => {
  test('un message de Chris en file prime sur tout', () => {
    expect(deciderSuite(etat({ messagesChrisEnVol: 1, objectifAtteint: true }))).toEqual({ action: 'laisser' });
  });

  test('objectif atteint → terminée, question → attente de Chris', () => {
    expect(deciderSuite(etat({ objectifAtteint: true }))).toMatchObject({ action: 'arreter', statut: 'terminee' });
    expect(deciderSuite(etat({ questionPosee: true }))).toMatchObject({ action: 'arreter', statut: 'question' });
  });

  test('fin d’étape lourde → compaction', () => {
    expect(deciderSuite(etat({ etapeTerminee: true, contexte: 200_000 }))).toMatchObject({ action: 'compacter' });
  });

  test('fin d’étape légère en autonomie → relance directe, sans compaction', () => {
    expect(deciderSuite(etat({ etapeTerminee: true, contexte: 60_000 }))).toMatchObject({ action: 'relancer' });
  });

  test('sortie de compaction → reprise de l’objectif, jamais une seconde compaction', () => {
    const s = deciderSuite(etat({ sortDeCompaction: true, contexte: 400_000 }));
    expect(s).toMatchObject({ action: 'relancer', raison: 'reprise après compaction' });
  });

  test('sans autonomie : on attend Chris', () => {
    expect(deciderSuite(etat({ autonomie: false }))).toEqual({ action: 'arreter', statut: 'attente' });
  });

  test('tours à vide répétés : l’autonomie se met en pause', () => {
    expect(deciderSuite(etat({ outilsCeTour: 0, relancesSansProgres: 1 }))).toMatchObject({ action: 'relancer' });
    expect(deciderSuite(etat({ outilsCeTour: 0, relancesSansProgres: 2 }))).toMatchObject({
      action: 'arreter',
      statut: 'attente',
    });
  });

  test('sous-agent en arrière-plan : on patiente au lieu de relancer', () => {
    expect(deciderSuite(etat({ sousAgentsActifs: 1, outilsCeTour: 0 }))).toEqual({ action: 'patienter' });
  });

  test('compaction demandée par Chris, même sur un petit contexte', () => {
    expect(deciderSuite(etat({ compactionDemandee: true, contexte: 30_000 }))).toMatchObject({ action: 'compacter' });
  });
});
