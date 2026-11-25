// Responsabilité : une notification de tâche (<task-notification>) n'est jamais une bulle de Chris, sur tous les
// chemins : transcript (texte seul, blocs, pièce jointe en file) et Remote Control (blocs sans origine).
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { traduire, type Ligne } from './traduction.ts';
import { traduireLot } from '../distant/traduction-distante.ts';
import { nouvelEtatTraduction } from './traduction-sdk.ts';
import type { EvenementBrut } from '../distant/donnees.ts';

const NOTIF = '<task-notification><tool-use-id>toolu_01ABC</tool-use-id><status>completed</status><summary>fini</summary></task-notification>';

describe('transcript : notification de tâche', () => {
  test('ligne user à blocs texte : résultat de l’outil, aucune bulle', () => {
    const l: Ligne = { type: 'user', uuid: 'u1', message: { content: [{ type: 'text', text: NOTIF }] } };
    expect(traduire(l)).toEqual([{ type: 'resultat_outil', outilId: 'toolu_01ABC', extrait: 'fini', erreur: false, finDeFond: true }]);
  });

  test('ligne user texte seul : résultat de l’outil, aucune bulle', () => {
    const l: Ligne = { type: 'user', uuid: 'u2', message: { content: NOTIF } };
    expect(traduire(l).map((e) => e.type)).toEqual(['resultat_outil']);
  });

  test('pièce jointe en file (tour humain) : résultat de l’outil, aucune bulle', () => {
    const l: Ligne = { type: 'attachment', attachment: { type: 'queued_command', prompt: NOTIF, origin: { kind: 'human' } } };
    expect(traduire(l).map((e) => e.type)).toEqual(['resultat_outil']);
  });

  test('un message de Chris ordinaire reste une bulle', () => {
    const l: Ligne = { type: 'user', uuid: 'u3', message: { content: [{ type: 'text', text: 'bonjour' }] } };
    expect(traduire(l)).toEqual([{ type: 'message', texte: 'bonjour', uuid: 'u3' }]);
  });
});

describe('Remote Control : notification de tâche remise en tour utilisateur', () => {
  const lot = (payload: unknown): EvenementBrut[] => [{ payload, creeLe: '2026-11-20T10:00:00.000Z' } as unknown as EvenementBrut];

  test('blocs sans origine : résultat de l’outil, aucune bulle', () => {
    const payload = { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'text', text: NOTIF }] } };
    const evts = traduireLot(lot(payload), nouvelEtatTraduction());
    expect(evts.map((e) => e.evt.type)).toEqual(['resultat_outil']);
  });

  test('origine task-notification en texte seul : résultat de l’outil', () => {
    const payload = { type: 'user', uuid: 'r2', origin: { kind: 'task-notification' }, message: { role: 'user', content: NOTIF } };
    const evts = traduireLot(lot(payload), nouvelEtatTraduction());
    expect(evts.map((e) => e.evt.type)).toEqual(['resultat_outil']);
  });
});
