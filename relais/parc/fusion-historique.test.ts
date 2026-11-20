// Responsabilité : tests de la fusion d'une relecture de transcript dans le fil — suite seule, sans doublon, sans
// réimportation d'une session pilotée par le poste.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { type DonneesPoste, Postes } from './postes.ts';

const MAJ = '2026-11-15T10:00:00.000Z';
const journal = pino({ enabled: false });

function session(id: string): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: id,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'fermee',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: 'conv',
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
  };
}

function montage(): { postes: Postes; registre: Registre; recus: MessageClient[] } {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  registre.enregistrerSession(session('s'));
  const diffusion = new Diffusion();
  const recus: MessageClient[] = [];
  diffusion.ajouter({
    send: (texte: string) => recus.push(JSON.parse(texte) as MessageClient),
  } as unknown as ServerWebSocket<unknown>);
  const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
  return { postes, registre, recus };
}

const fauxPoste = { data: { machine: 'tour' } } as unknown as ServerWebSocket<DonneesPoste>;

// Un message de Chris ou une réponse du transcript : à `ts` fixe, uuid de la ligne.
function msg(uuid: string, texte: string, ts = MAJ): { ts: string; evt: Evenement } {
  return { ts, evt: { type: 'message', texte, uuid } };
}
function rep(uuid: string, texte: string, ts = MAJ): { ts: string; evt: Evenement } {
  return { ts, evt: { type: 'texte', texte, uuid } };
}

function envoyerLot(postes: Postes, replay: string, evenements: { ts: string; evt: Evenement }[]): void {
  postes.recu(fauxPoste, JSON.stringify({ kind: 'historique', sessionId: 's', replay, evenements }));
}

function textesDuFil(registre: Registre): string[] {
  return registre
    .derniersEvenements('s', 300)
    .map((e) => (e.evt.type === 'message' || e.evt.type === 'texte' ? e.evt.texte : e.evt.type));
}

describe('relecture fusionnée dans un fil déjà rempli', () => {
  test('fil rempli + relecture contenant l’ancien + 3 nouveaux : seuls les 3 nouveaux s’ajoutent, dans l’ordre', () => {
    const { postes, registre, recus } = montage();
    registre.ajouterHistorique('s', [msg('m1', 'un'), rep('r1', 'deux')]);
    envoyerLot(postes, 'r-a', [
      msg('m1', 'un'),
      rep('r1', 'deux'),
      msg('m2', 'trois'),
      rep('r2', 'quatre'),
      msg('m3', 'cinq'),
    ]);

    expect(textesDuFil(registre)).toEqual(['un', 'deux', 'trois', 'quatre', 'cinq']);
    expect(recus.filter((m) => m.type === 'evenement')).toHaveLength(3);
  });

  test('la même relecture, envoyée deux fois : aucun doublon', () => {
    const { postes, registre } = montage();
    const lot = [msg('m1', 'un'), rep('r1', 'deux'), msg('m2', 'trois')];
    envoyerLot(postes, 'r-1', lot);
    envoyerLot(postes, 'r-2', lot);

    expect(textesDuFil(registre)).toEqual(['un', 'deux', 'trois']);
  });

  test('relecture après compaction (résumé puis suite) : la suite s’ajoute, l’ancien ne se répète pas', () => {
    const { postes, registre } = montage();
    registre.ajouterHistorique('s', [msg('m1', 'un'), rep('r1', 'deux')]);
    envoyerLot(postes, 'r-c', [
      msg('m1', 'un'),
      rep('r1', 'deux'),
      rep('resume', 'Résumé de la conversation'),
      msg('m2', 'suite'),
      rep('r2', 'réponse'),
    ]);

    expect(textesDuFil(registre)).toEqual(['un', 'deux', 'Résumé de la conversation', 'suite', 'réponse']);
  });

  test('une relecture découpée en lots : l’ancre est cherchée dans chaque lot jusqu’à ce qu’elle se trouve', () => {
    const { postes, registre } = montage();
    registre.ajouterHistorique('s', [msg('m1', 'un')]);
    envoyerLot(postes, 'r-l', [msg('m0', 'avant'), rep('r0', 'avant aussi')]);
    expect(textesDuFil(registre)).toEqual(['un']);
    envoyerLot(postes, 'r-l', [msg('m1', 'un'), msg('m2', 'deux')]);
    envoyerLot(postes, 'r-l', [rep('r2', 'trois')]);

    expect(textesDuFil(registre)).toEqual(['un', 'deux', 'trois']);
  });
});

describe('pas de réimportation quand rien ne se raccorde', () => {
  test('session pilotée par le poste (fil écrit en direct, horodatages propres) : la relecture n’ajoute rien', () => {
    const { postes, registre } = montage();
    registre.ajouterEvenement('s', '2026-11-16T09:00:00.000Z', { type: 'message', texte: 'un', uuid: 'direct-1' });
    registre.ajouterEvenement('s', '2026-11-16T09:00:05.000Z', { type: 'texte', texte: 'deux' });
    envoyerLot(postes, 'r-p', [msg('m1', 'un'), rep('r1', 'deux'), msg('m2', 'trois')]);

    expect(textesDuFil(registre)).toEqual(['un', 'deux']);
  });
});
