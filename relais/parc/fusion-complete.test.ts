// Responsabilité : tests de la fusion d'une relecture complète (trous comblés à leur place, sans doublon, fil désynchronisé
// remplacé) et de la fusion par uuid des relectures en suite.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { cleDeDoublon, type EvenementHorodate, planifierFusion, type LigneFil } from './fusion-historique.ts';
import { type DonneesPoste, Postes } from './postes.ts';

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
    creeLe: '2026-11-15T10:00:00.000Z',
    majLe: '2026-11-15T10:00:00.000Z',
  } as ResumeSession;
}

interface Montage {
  readonly postes: Postes;
  readonly registre: Registre;
  readonly recus: MessageClient[];
  readonly envoyes: string[];
}

function montage(): Montage {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  registre.enregistrerSession(session('s'));
  const diffusion = new Diffusion();
  const recus: MessageClient[] = [];
  diffusion.ajouter({ send: (t: string) => recus.push(JSON.parse(t) as MessageClient) } as unknown as ServerWebSocket<unknown>);
  const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
  const envoyes: string[] = [];
  const ws = { data: { machine: 'tour' }, send: (t: string) => envoyes.push(t), close: () => undefined } as unknown as ServerWebSocket<DonneesPoste>;
  postes.ouvert(ws);
  return { postes, registre, recus, envoyes: envoyes };
}

const fauxPoste = { data: { machine: 'tour' } } as unknown as ServerWebSocket<DonneesPoste>;

function msg(uuid: string, texte: string, ts: string): EvenementHorodate {
  return { ts, evt: { type: 'message', texte, uuid } };
}
function rep(uuid: string, texte: string, ts: string): EvenementHorodate {
  return { ts, evt: { type: 'texte', texte, uuid } };
}

function envoyerLot(postes: Postes, replay: string, lot: readonly EvenementHorodate[]): void {
  postes.recu(fauxPoste, JSON.stringify({ kind: 'historique', sessionId: 's', replay, evenements: lot }));
}

function textes(registre: Registre, id = 's'): string[] {
  return registre.derniersEvenements(id, 1000).map((e) => (e.evt.type === 'message' || e.evt.type === 'texte' ? e.evt.texte : e.evt.type));
}

const T = (n: number): string => `2026-11-18T10:${String(n).padStart(2, '0')}:00.000Z`;

describe('planification pure de la fusion', () => {
  test('un trou se place à son rang chronologique, sans toucher aux lignes existantes', () => {
    const existants: LigneFil[] = [
      { ts: T(1), evt: { type: 'message', texte: 'un', uuid: 'a' }, seq: 1, cle: cleDeDoublon(msg('a', 'un', T(1))) },
      { ts: T(5), evt: { type: 'message', texte: 'cinq', uuid: 'e' }, seq: 2, cle: cleDeDoublon(msg('e', 'cinq', T(5))) },
    ];
    const plan = planifierFusion(existants, [msg('a', 'un', T(1)), msg('b', 'deux', T(2)), msg('e', 'cinq', T(5))]);
    expect(plan.fil.map((l) => l.evt)).toEqual([
      { type: 'message', texte: 'un', uuid: 'a' },
      { type: 'message', texte: 'deux', uuid: 'b' },
      { type: 'message', texte: 'cinq', uuid: 'e' },
    ]);
    expect(plan.premierDeplace).toBe(1);
  });

  test('un lot qui ne fait que s’ajouter à la fin ne déplace rien', () => {
    const existants: LigneFil[] = [
      { ts: T(1), evt: { type: 'message', texte: 'un', uuid: 'a' }, seq: 1, cle: cleDeDoublon(msg('a', 'un', T(1))) },
    ];
    expect(planifierFusion(existants, [msg('b', 'deux', T(2))]).premierDeplace).toBe(-1);
  });

  test('une même clé dans le lot n’est ajoutée qu’une fois', () => {
    const plan = planifierFusion([], [msg('x', 'un', T(1)), msg('x', 'un', T(1))]);
    expect(plan.fil).toHaveLength(1);
  });

  test('deux textes d’une même ligne (même uuid) restent distincts', () => {
    const plan = planifierFusion([], [rep('r', 'avant outil', T(1)), rep('r', 'après outil', T(1))]);
    expect(plan.fil).toHaveLength(2);
  });
});

describe('relecture complète : trous comblés', () => {
  test('la queue demande une relecture complète ; elle comble le trou à sa place, sans doublon', () => {
    const { postes, registre, envoyes } = montage();
    registre.ajouterHistorique('s', [msg('a', 'un', T(1)), msg('e', 'cinq', T(5))]);
    envoyerLot(postes, 'queue', [msg('f', 'six', T(6)), msg('g', 'sept', T(7))]);
    expect(envoyes.some((m) => m.includes('"kind":"historique"'))).toBe(true);

    envoyerLot(postes, 'complet', [
      msg('a', 'un', T(1)),
      msg('b', 'deux', T(2)),
      msg('c', 'trois', T(3)),
      msg('e', 'cinq', T(5)),
      msg('f', 'six', T(6)),
      msg('g', 'sept', T(7)),
    ]);
    expect(textes(registre)).toEqual(['un', 'deux', 'trois', 'cinq', 'six', 'sept']);
  });

  test('une relecture complète envoyée deux fois ne double rien', () => {
    const { postes, registre } = montage();
    registre.ajouterHistorique('s', [msg('a', 'un', T(1))]);
    envoyerLot(postes, 'queue', [msg('e', 'cinq', T(5)), msg('z', 'z', T(6))]);
    const complet = [msg('a', 'un', T(1)), msg('b', 'deux', T(2)), msg('e', 'cinq', T(5))];
    envoyerLot(postes, 'complet', complet);
    envoyerLot(postes, 'complet-2', complet);
    expect(textes(registre)).toEqual(['un', 'deux', 'cinq']);
  });

  test('une relecture complète sur un fil écrit en direct (uuid identiques) n’importe que le manquant', () => {
    const { postes, registre } = montage();
    registre.ajouterEvenement('s', T(1), { type: 'message', texte: 'un', uuid: 'a' });
    registre.ajouterEvenement('s', T(9), { type: 'message', texte: 'neuf', uuid: 'n' });
    envoyerLot(postes, 'queue', [rep('x', 'onze', T(11))]);
    envoyerLot(postes, 'complet', [msg('a', 'un', T(1)), msg('b', 'deux', T(2)), msg('n', 'neuf', T(9)), rep('x', 'onze', T(11))]);
    expect(textes(registre)).toEqual(['un', 'deux', 'neuf', 'onze']);
  });
});

describe('fil désynchronisé remplacé', () => {
  test('aucune ligne du transcript en commun avec la relecture complète : le fil est remplacé', () => {
    const { postes, registre } = montage();
    registre.ajouterEvenement('s', T(1), { type: 'message', texte: 'autre source', uuid: 'rc-1' });
    registre.ajouterEvenement('s', T(2), { type: 'texte', texte: 'autre réponse', uuid: 'rc-2' });
    envoyerLot(postes, 'queue', [msg('f', 'six', T(6))]);
    envoyerLot(postes, 'complet', [msg('a', 'un', T(1)), msg('b', 'deux', T(2))]);
    envoyerLot(postes, 'complet', [msg('c', 'trois', T(3))]);
    expect(textes(registre)).toEqual(['un', 'deux', 'trois']);
  });

  test('une relecture en suite (non demandée) ne remplace jamais un fil', () => {
    const { postes, registre } = montage();
    registre.ajouterEvenement('s', T(1), { type: 'message', texte: 'autre source', uuid: 'rc-1' });
    envoyerLot(postes, 'suite', [msg('a', 'un', T(0)), msg('b', 'deux', T(0))]);
    expect(textes(registre)).toContain('autre source');
  });
});

describe('dédoublonnage par uuid en suite', () => {
  test('en suite, un lot après l’ancre n’ajoute que le nouveau, sans reprendre ce qui est déjà au fil', () => {
    const { postes, registre } = montage();
    registre.ajouterEvenement('s', T(3), { type: 'texte', texte: 'deux', uuid: 'b' });
    envoyerLot(postes, 'suite', [msg('a', 'un', T(1)), rep('b', 'deux', T(2)), rep('c', 'trois', T(4))]);
    expect(textes(registre)).toEqual(['deux', 'trois']);
  });
});

describe('désynchronisation détectée sans ancre commune', () => {
  test('un lot ancien qui ne se raccorde à rien demande la relecture complète, qui remplace le fil désynchronisé', () => {
    const { postes, registre, envoyes } = montage();
    registre.ajouterEvenement('s', T(2), { type: 'texte', texte: 'autre', uuid: 'rc-2' });
    envoyerLot(postes, 'suite', [msg('a', 'un', T(1))]);
    expect(envoyes.some((m) => m.includes('"kind":"historique"'))).toBe(true);
    envoyerLot(postes, 'complet', [msg('a', 'un', T(1)), msg('b', 'deux', T(3))]);
    expect(textes(registre)).toEqual(['un', 'deux']);
  });

  test('un premier lot qui ne couvre pas le fil ne le remplace pas (ses lignes récentes peuvent être communes)', () => {
    const { postes, registre } = montage();
    registre.ajouterEvenement('s', T(9), { type: 'texte', texte: 'neuf', uuid: 'n' });
    const outil = { type: 'outil' as const, id: 'o-1', nom: 'Bash', resume: 'ls', detail: '', agent: 'ag-1' };
    registre.ajouterEvenement('s', T(9), outil);
    envoyerLot(postes, 'queue', [msg('z', 'dix', T(10))]);
    envoyerLot(postes, 'complet', [msg('a', 'un', T(1))]);
    envoyerLot(postes, 'complet', [rep('n', 'neuf', T(9))]);
    expect(textes(registre)).toEqual(['un', 'neuf', 'outil']);
  });
});
