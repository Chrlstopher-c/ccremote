// Responsabilité : tests du recalage côté relais — message `recalage` (fil nettoyé, fiche rangée si archivée Desktop,
// relecture complète qui comble le trou) et rattachement d'une session Remote Control à sa découverte par son pont.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { type DonneesPoste, Postes } from './postes.ts';
import {
  cleDeDoublon,
  type EvenementHorodate,
  estEchoDirect,
  type LigneFil,
  planifierFusion,
} from './fusion-historique.ts';

const journal = pino({ enabled: false });
const MAJ = '2026-11-18T10:00:00.000Z';
const T = (n: number): string => `2026-11-18T10:${String(n).padStart(2, '0')}:00.000Z`;
const msg = (texte: string, uuid?: string): Evenement =>
  uuid ? { type: 'message', texte, uuid } : { type: 'message', texte };

function session(id: string, distant: ResumeSession['distant'] = null): ResumeSession {
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
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
    ...(distant ? { distant } : {}),
  };
}

interface Montage {
  readonly postes: Postes;
  readonly registre: Registre;
  readonly poste: ServerWebSocket<DonneesPoste>;
}

// Un poste « tour » connecté : ses messages passent par `recu`, comme sur la liaison réelle.
function montage(): Montage {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  const diffusion = new Diffusion();
  // Faux client de diffusion : les messages sortants ne sont pas relus ici.
  diffusion.ajouter({ send: () => undefined } as unknown as ServerWebSocket<unknown>);
  const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
  // Faux socket : seuls `data.machine` et `send`/`close` sont lus ici.
  const poste = {
    data: { machine: 'tour' },
    send: () => undefined,
    close: () => undefined,
  } as unknown as ServerWebSocket<DonneesPoste>;
  postes.ouvert(poste);
  return { postes, registre, poste };
}

function envoyer(m: Montage, message: object): void {
  m.postes.recu(m.poste, JSON.stringify(message));
}

function textes(registre: Registre, id = 's'): string[] {
  return registre
    .derniersEvenements(id, 1000)
    .map((e) => (e.evt.type === 'message' || e.evt.type === 'texte' ? e.evt.texte : e.evt.type));
}

describe('message recalage', () => {
  test('le fil est nettoyé, la fiche rangée si Desktop l’a archivée, et la relecture complète comble le trou', () => {
    const m = montage();
    envoyer(m, { kind: 'session', session: session('s') });
    const inserer = (ts: string, evt: Evenement): void => {
      m.registre.ajouterEvenement('s', ts, evt);
    };
    inserer(T(1), msg('un', 'a'));
    inserer(T(1), msg('un', 'a'));
    inserer(T(2), msg('<task-notification>tâche finie</task-notification>'));
    inserer(T(3), msg('trois', 'c'));

    envoyer(m, { kind: 'recalage', sessionId: 's', archiver: true });
    envoyer(m, {
      kind: 'historique',
      sessionId: 's',
      replay: 'r1',
      evenements: [
        { ts: T(1), evt: msg('un', 'a') },
        { ts: T(2), evt: msg('deux', 'b') },
      ],
    });
    envoyer(m, {
      kind: 'historique',
      sessionId: 's',
      replay: 'r1',
      evenements: [{ ts: T(3), evt: msg('trois', 'c') }],
    });

    expect(textes(m.registre)).toEqual(['un', 'deux', 'trois']);
    expect(m.registre.sessions(false).map((s) => s.id)).not.toContain('s');
    expect(m.registre.sessions(true).find((s) => s.id === 's')?.archivee).toBe(true);
  });
});

describe('session Remote Control rattachée à sa découverte par son pont', () => {
  test('la conversation, la machine et le dossier réels viennent de la découverte qui porte le pont', () => {
    const m = montage();
    envoyer(m, {
      kind: 'decouvertes',
      decouvertes: [
        {
          id: 'conv-1',
          machine: 'tour',
          cwd: '/home/x/proj',
          titre: 'Découverte',
          modifieLe: MAJ,
          branche: null,
          messages: 3,
          ponts: ['cse_ABC'],
        },
      ],
    });
    const distant = { compte: 'principal', idDistant: 'cse_ABC', connexion: 'connectee' as const, probleme: null };
    envoyer(m, { kind: 'session', session: session('cse_ABC', distant) });

    expect(m.registre.session('cse_ABC')?.distant).toMatchObject({
      conversation: 'conv-1',
      machineReelle: 'tour',
      cwdReel: '/home/x/proj',
    });
  });
});

// Écho direct : un message écrit en direct (sans uuid, à l'envoi) et sa ligne relue du transcript (uuid) ne font qu'un.
describe('écho direct — planification pure', () => {
  const existant: LigneFil = { ts: T(1), evt: msg('a'), seq: 1, cle: cleDeDoublon({ ts: T(1), evt: msg('a') }) };
  const relu = (ts: string, texte: string): EvenementHorodate => ({ ts, evt: msg(texte, 'u1') });

  test('un message relu avec uuid, même texte à moins de 10 min, n’entre pas une seconde fois', () => {
    const plan = planifierFusion([existant], [relu(T(2), 'a')]);
    expect(plan.fil).toHaveLength(1);
    expect(plan.premierDeplace).toBe(-1);
  });

  test('au-delà de 10 min, la ligne relue entre comme un nouveau message', () => {
    const plan = planifierFusion([existant], [relu('2026-11-18T10:12:00.000Z', 'a')]);
    expect(plan.fil.map((l) => l.evt)).toEqual([msg('a'), msg('a', 'u1')]);
  });

  test('un texte différent n’est pas un écho et entre', () => {
    expect(planifierFusion([existant], [relu(T(2), 'b')]).fil).toHaveLength(2);
  });

  test('estEchoDirect exige un message sans uuid à gauche et avec uuid à droite', () => {
    expect(estEchoDirect({ ts: T(1), evt: msg('a', 'x') }, { ts: T(1), evt: msg('a', 'u1') })).toBe(false);
    expect(estEchoDirect({ ts: T(1), evt: msg('a') }, { ts: T(1), evt: msg('a') })).toBe(false);
  });
});

describe('écho direct — relecture complète par le relais', () => {
  test('une ligne écrite en direct, relue avec uuid à moins de 10 min : un seul message', () => {
    const m = montage();
    envoyer(m, { kind: 'session', session: session('s') });
    m.registre.ajouterEvenement('s', T(1), { type: 'message', texte: 'a' });
    envoyer(m, { kind: 'recalage', sessionId: 's', archiver: false });
    envoyer(m, { kind: 'historique', sessionId: 's', replay: 'r1', evenements: [{ ts: T(2), evt: msg('a', 'u1') }] });
    expect(textes(m.registre)).toEqual(['a']);
  });

  test('la même ligne relue plus de 10 min après l’envoi entre comme un second message', () => {
    const m = montage();
    envoyer(m, { kind: 'session', session: session('s') });
    m.registre.ajouterEvenement('s', T(1), { type: 'message', texte: 'a' });
    envoyer(m, { kind: 'recalage', sessionId: 's', archiver: false });
    const tard = '2026-11-18T10:12:00.000Z';
    envoyer(m, { kind: 'historique', sessionId: 's', replay: 'r1', evenements: [{ ts: tard, evt: msg('a', 'u1') }] });
    expect(textes(m.registre)).toEqual(['a', 'a']);
  });
});

// Fil désynchronisé : la relecture complète ne remplace le fil qu'au premier lot qui le couvre sans rien partager.
describe('fil désynchronisé — remplacement par la relecture complète', () => {
  test('un premier lot complet qui ne couvre pas la ligne la plus récente du fil ne remplace jamais le fil', () => {
    const m = montage();
    envoyer(m, { kind: 'session', session: session('s') });
    m.registre.ajouterEvenement('s', T(9), { type: 'texte', texte: 'neuf', uuid: 'n' });
    envoyer(m, { kind: 'recalage', sessionId: 's', archiver: false });
    envoyer(m, { kind: 'historique', sessionId: 's', replay: 'r1', evenements: [{ ts: T(1), evt: msg('un', 'a') }] });
    expect(textes(m.registre)).toEqual(['un', 'neuf']);
  });

  test('un premier lot qui couvre le fil sans rien partager le remplace, sauf les sous-agents appelés', () => {
    const m = montage();
    envoyer(m, { kind: 'session', session: session('s') });
    const ajouter = (evt: Evenement): void => {
      m.registre.ajouterEvenement('s', T(1), evt);
    };
    ajouter({ type: 'texte', texte: 'autre', uuid: 'rc-2' });
    ajouter({ type: 'texte', texte: 'sous-agent 1', uuid: 'sa-1', agent: 'ag-1' });
    ajouter({ type: 'texte', texte: 'sous-agent 3', uuid: 'sa-3', agent: 'ag-3' });
    ajouter({ type: 'texte', texte: 'sous-agent 2', uuid: 'sa-2', agent: 'ag-2' });
    envoyer(m, { kind: 'recalage', sessionId: 's', archiver: false });
    envoyer(m, {
      kind: 'historique',
      sessionId: 's',
      replay: 'r1',
      evenements: [
        { ts: T(1), evt: msg('un', 'a') },
        { ts: T(2), evt: { type: 'outil', id: 'ag-1', nom: 'Agent', resume: 'tâche', detail: '' } },
        { ts: T(2), evt: { type: 'sous_agent', id: 'ag-2', description: 'veille', modele: 'haiku', genre: 'general' } },
      ],
    });
    // Le sous-agent `ag-3` n'est appelé par aucun événement du lot : sa ligne part avec le fil remplacé.
    expect(textes(m.registre)).toEqual(['sous-agent 1', 'sous-agent 2', 'un', 'outil', 'sous_agent']);
  });
});
