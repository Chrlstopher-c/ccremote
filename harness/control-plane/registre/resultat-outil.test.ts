/**
 * `☠` Le fil montrait ce que le lead LANÇAIT, jamais ce que ça donnait : le
 * collecteur ignorait purement les messages `user` du SDK, qui portent les
 * `tool_result`. On lisait la question sans jamais la réponse.
 *
 * L'appariement se fait sur `tool_use_id`, et c'est le seul endroit où un
 * résultat peut se perdre en silence : un `UPDATE` qui ne trouve pas sa ligne
 * ne lève pas. Ces tests gardent chacun un cas où ça arriverait.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type Registre } from './index.ts';

let repertoire: string;
let registre: Registre;
const T = 1_785_000_000_000;

function semer(id = 'm-1'): void {
  registre.lots.creer({ id: `lot-${id}`, intention: 'objectif' });
  registre.missions.creer({
    id, lotId: `lot-${id}`, nom: `équipe ${id}`, projet: `/p/${id}`, compteId: 'compte-a',
  }, T);
}

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'resultat-outil-'));
  registre = ouvrirRegistre({ chemin: join(repertoire, 'registre.sqlite') });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/cc-a' });
  semer();
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoire, { recursive: true, force: true });
});

describe('un résultat rejoint son appel', () => {
  test('la sortie est attachée à l’appel qui l’a produite', () => {
    registre.missions.ajouterActivite('m-1', 'command=ls -la', T, 'outil', 'Bash', 'toolu_01');
    expect(registre.missions.poserResultatOutil('m-1', 'toolu_01', 'total 42\ndrwxr-xr-x', false)).toBe(true);
    const a = registre.missions.activites('m-1').at(-1);
    expect(a?.resultat).toContain('total 42');
    expect(a?.resultatErreur).toBe(false);
  });

  test('une erreur d’outil est marquée comme telle', () => {
    registre.missions.ajouterActivite('m-1', 'command=faux', T, 'outil', 'Bash', 'toolu_02');
    registre.missions.poserResultatOutil('m-1', 'toolu_02', 'command not found', true);
    expect(registre.missions.activites('m-1').at(-1)?.resultatErreur).toBe(true);
  });

  test('LE cas qui casse tout : deux appels en vol, résultats dans le désordre', () => {
    // `☠` Apparier « le dernier appel » au lieu de l'identifiant collerait la
    // sortie de A sur B. Plusieurs outils tournent de front en permanence et
    // leurs résultats reviennent dans un ordre quelconque.
    registre.missions.ajouterActivite('m-1', 'command=A', T, 'outil', 'Bash', 'toolu_A');
    registre.missions.ajouterActivite('m-1', 'command=B', T + 1, 'outil', 'Bash', 'toolu_B');
    registre.missions.poserResultatOutil('m-1', 'toolu_B', 'sortie de B', false);
    registre.missions.poserResultatOutil('m-1', 'toolu_A', 'sortie de A', false);
    const [a, b] = registre.missions.activites('m-1');
    expect(a?.resultat).toBe('sortie de A');
    expect(b?.resultat).toBe('sortie de B');
  });

  test('un résultat sans appel connu ne casse rien et se signale', () => {
    // Cas réel : worker relancé, ou activité purgée. `false` permet à l'appelant
    // de le journaliser au lieu de croire l'écriture faite.
    expect(registre.missions.poserResultatOutil('m-1', 'toolu_inconnu', 'x', false)).toBe(false);
  });

  test('un résultat ne traverse pas les missions', () => {
    semer('m-2');
    registre.missions.ajouterActivite('m-1', 'command=A', T, 'outil', 'Bash', 'toolu_X');
    // Le même identifiant sur une autre mission ne doit rien toucher : l'appel
    // est identifié par le couple (mission, tool_use_id), jamais par l'id seul.
    expect(registre.missions.poserResultatOutil('m-2', 'toolu_X', 'fuite', false)).toBe(false);
    expect(registre.missions.activites('m-1').at(-1)?.resultat).toBeNull();
  });

  test('tant que rien n’est revenu, le résultat est nul — pas une chaîne vide', () => {
    registre.missions.ajouterActivite('m-1', 'command=en cours', T, 'outil', 'Bash', 'toolu_03');
    // L'interface distingue « pas encore revenu » de « sortie vide » : les deux
    // ne demandent pas la même lecture.
    expect(registre.missions.activites('m-1').at(-1)?.resultat).toBeNull();
  });

  test('une activité sans outil n’a pas d’identifiant d’appel', () => {
    registre.missions.ajouterActivite('m-1', 'Je commence.', T, 'texte');
    expect(registre.missions.activites('m-1').at(-1)?.outilId).toBeNull();
  });
});
