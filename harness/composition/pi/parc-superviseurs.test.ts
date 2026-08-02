/**
 * Le routage multi-machines : à qui part un ordre, et ce qui se passe quand la
 * réponse est « je ne sais pas ».
 *
 * `☠` Ce qui est éprouvé ici n'est pas du confort d'API : c'est la différence
 * entre un ordre d'arrêt qui atteint l'équipe et un ordre d'arrêt qui part dans
 * le vide pendant que l'équipe continue de dépenser.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../control-plane/registre/index.ts';
import type { ClientSuperviseurPc } from './client-superviseur-pc.ts';
import { creerAgregatParc, ErreurRoutageMachine, ParcSuperviseurs } from './parc-superviseurs.ts';

let registre: Registre;
let enLigne: Set<string>;

/** Doublure : seules les méthodes réellement appelées par le routage existent. */
function clientFactice(nom: string, journal: string[]): ClientSuperviseurPc {
  return {
    arreter: async (missionId: string) => {
      journal.push(`${nom}:arreter:${missionId}`);
    },
    telemetrie: async () => [{ sessionId: `${nom}-s1` }],
    jetons: async () => [{ compteId: 'compte-a', jetonAcces: nom, expireA: 0 }],
  } as unknown as ClientSuperviseurPc;
}

function creerParc(...machines: string[]): { parc: ParcSuperviseurs; journal: string[] } {
  const journal: string[] = [];
  const parc = new ParcSuperviseurs({ registre, enLigne: (m) => enLigne.has(m) });
  for (const m of machines) {
    parc.enregistrer(m, clientFactice(m, journal));
    enLigne.add(m);
  }
  return { parc, journal };
}

function creerMission(id: string, machine: string | null): void {
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/a' });
  registre.lots.creer({ id: `lot-${id}`, intention: 'test', origine: 'orchestrateur' });
  registre.missions.creer({
    id,
    lotId: `lot-${id}`,
    nom: id,
    projet: `/mnt/projects/${id}`,
    compteId: 'compte-a',
    sessionId: `sess-${id}`,
    machine,
  });
}

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  enLigne = new Set<string>();
});

afterEach(() => {
  registre.fermer();
});

describe('routage par mission', () => {
  test('l’ordre part vers la machine où l’équipe tourne, jamais vers l’autre', async () => {
    const { parc, journal } = creerParc('trinityarch', 'vps');
    creerMission('m-vps', 'vps');
    creerMission('m-pc', 'trinityarch');

    await parc.pourMission('m-vps').client.arreter('m-vps');
    await parc.pourMission('m-pc').client.arreter('m-pc');

    expect(journal).toEqual(['vps:arreter:m-vps', 'trinityarch:arreter:m-pc']);
  });

  test('☠ machine hors ligne ⇒ REFUS explicite, jamais un ordre perdu en silence', () => {
    const { parc } = creerParc('vps');
    creerMission('m-vps', 'vps');
    enLigne.delete('vps');

    // Un arrêt silencieusement perdu est pire que pas d'arrêt : l'opérateur
    // croit l'équipe coupée, et elle continue de dépenser.
    expect(() => parc.pourMission('m-vps')).toThrow(ErreurRoutageMachine);
    expect(() => parc.pourMission('m-vps')).toThrow(/hors ligne/);
  });

  test('le refus NOMME les machines utilisables — un modèle se corrige sur une liste', () => {
    const { parc } = creerParc('trinityarch');
    creerMission('m-ailleurs', 'machine-disparue');

    expect(() => parc.pourMission('m-ailleurs')).toThrow(/machine-disparue/);
    expect(() => parc.pourMission('m-ailleurs')).toThrow(/trinityarch/);
  });
});

describe('machine non précisée (missions et fils d’avant la migration 22)', () => {
  test('une seule machine en ligne ⇒ résolu sans ambiguïté', () => {
    const { parc } = creerParc('vps');
    creerMission('m-legacy', null);
    expect(parc.pourMission('m-legacy').machineId).toBe('vps');
  });

  test('☠ deux machines en ligne ⇒ REFUS, jamais un tirage au sort', () => {
    // Deviner reviendrait à lancer une équipe sur la mauvaise machine, sur un
    // clone du même dépôt, en silence — le pire résultat possible.
    const { parc } = creerParc('trinityarch', 'vps');
    creerMission('m-legacy', null);
    expect(() => parc.pourMission('m-legacy')).toThrow(/plusieurs sont en ligne/);
  });

  test('aucune machine en ligne ⇒ refus qui le dit', () => {
    const { parc } = creerParc('vps');
    enLigne.delete('vps');
    creerMission('m-legacy', null);
    expect(() => parc.pourMission('m-legacy')).toThrow(/aucune machine de travail n'est en ligne/);
  });
});

describe('routage par conversation', () => {
  test('un fil emmène ses lectures de projet sur SA machine', () => {
    const { parc } = creerParc('trinityarch', 'vps');
    registre.conversations.creer({ id: 'fil-vps', titre: 'stockiop', machine: 'vps' });
    registre.conversations.creer({ id: 'fil-pc', titre: 'lumen', machine: 'trinityarch' });

    expect(parc.pourConversation('fil-vps').machineId).toBe('vps');
    expect(parc.pourConversation('fil-pc').machineId).toBe('trinityarch');
  });

  test('la machine du fil est persistée telle quelle, jamais réécrite', () => {
    creerParc('vps');
    registre.conversations.creer({ id: 'fil', titre: 't', machine: 'vps' });
    expect(registre.conversations.lire('fil')?.machine).toBe('vps');
  });

  test('☠ ADOPTION — un fil sans machine FIGE le choix implicite dès la 1re opération', () => {
    const { parc } = creerParc('vps');
    registre.conversations.creer({ id: 'fil-nu', titre: 'ouvert PC éteint' });
    expect(registre.conversations.lire('fil-nu')?.machine).toBeNull();

    expect(parc.pourConversation('fil-nu').machineId).toBe('vps');
    expect(registre.conversations.lire('fil-nu')?.machine).toBe('vps');
  });

  test('☠ LE DÉFAUT DU 02/08 — le fil adopté survit à l’allumage de la 2e machine', () => {
    const { parc } = creerParc('vps');
    registre.conversations.creer({ id: 'fil-nu', titre: 'ouvert PC éteint' });
    // Première opération pendant que le VPS est seul : adoption.
    parc.pourConversation('fil-nu');

    // Le PC démarre. AVANT le correctif, ce fil basculait ici en refus définitif.
    parc.enregistrer('trinityarch', clientFactice('trinityarch', []));
    enLigne.add('trinityarch');
    expect(parc.pourConversation('fil-nu').machineId).toBe('vps');
  });

  test('sans adoption possible (deux machines, aucune écrite) ⇒ refus qui NOMME les candidates', () => {
    const { parc } = creerParc('trinityarch', 'vps');
    registre.conversations.creer({ id: 'fil-nu', titre: 'ambigu' });
    expect(() => parc.pourConversation('fil-nu')).toThrow(ErreurRoutageMachine);
    expect(registre.conversations.lire('fil-nu')?.machine).toBeNull();
  });

  test('aucune machine en ligne ⇒ refus, et RIEN n’est écrit (pas d’adoption fantôme)', () => {
    const { parc } = creerParc('vps');
    enLigne.delete('vps');
    registre.conversations.creer({ id: 'fil-nu', titre: 'hors ligne' });
    expect(() => parc.pourConversation('fil-nu')).toThrow(ErreurRoutageMachine);
    expect(registre.conversations.lire('fil-nu')?.machine).toBeNull();
  });
});

describe('relevés globaux (H-75 : une machine éteinte n’est pas une panne)', () => {
  test('la télémétrie agrège les machines EN LIGNE seulement', async () => {
    const { parc } = creerParc('trinityarch', 'vps');
    const agregat = creerAgregatParc(parc);
    expect((await agregat.telemetrie()).length).toBe(2);

    enLigne.delete('trinityarch');
    // Une machine éteinte n'apporte rien ET ne doit pas faire échouer le relevé
    // des autres : c'est H-75 appliqué à la lettre.
    expect((await agregat.telemetrie()).length).toBe(1);
  });

  test('☠ un compte déclaré sur deux machines ne remonte qu’une fois', async () => {
    // `compte-a` existe sur le PC ET sur le VPS. Deux relevés concurrents pour
    // un même identifiant feraient osciller la jauge sans que rien ne l'explique.
    const { parc } = creerParc('trinityarch', 'vps');
    const jetons = await creerAgregatParc(parc).jetons();
    expect(jetons.length).toBe(1);
    expect(jetons[0]?.compteId).toBe('compte-a');
  });
});
