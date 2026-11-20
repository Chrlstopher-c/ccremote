import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { TEXTE_REFUS_SANS_JUMELLE } from '../parc/aiguillage.ts';
import { Diffusion } from './diffusion.ts';
import { ApiSessions } from './api-sessions.ts';

// Session tenue dans Claude Desktop : ses envoyer et interrompre partent vers sa jumelle Remote Control (cse_).
const journal = pino({ enabled: false });
const MAJ = '2026-11-21T10:00:00.000Z';

function fiche(id: string, extra: Partial<ResumeSession> = {}): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: `Titre ${id}`,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: 'conv-1',
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
    ...extra,
  };
}

const TENUE = fiche('s1', { terminal: true });
const JUMELLE = fiche('cse_a', {
  machine: 'portable',
  distant: { compte: 'defaut', idDistant: 'x', connexion: 'connectee', probleme: null, conversation: 'conv-1' },
});

type Recue = { machine: string; commande: Record<string, unknown> };

function postesSimules(reponse: ReponsePoste) {
  const recues: Recue[] = [];
  const postes = {
    commander: (machine: string, commande: Record<string, unknown>) => {
      recues.push({ machine, commande });
      return Promise.resolve(reponse);
    },
    vues: () => [],
    decouvertes: () => [],
  } as unknown as Postes;
  return { postes, recues };
}

function sessions(postes: Postes, fiches: ResumeSession[]): ApiSessions {
  const registre = new Registre(ouvrirBase(':memory:'));
  for (const f of fiches) registre.enregistrerSession(f);
  return new ApiSessions(registre, postes, new Diffusion(), new Set(), journal);
}

function requete(id: string, corps: unknown) {
  const init: RequestInit = { method: 'POST', body: JSON.stringify(corps) };
  return Object.assign(new Request('http://relais.test/api', init), { params: { id } });
}

const PIECES = [{ nom: 'note.txt', mime: 'text/plain', base64: 'YWJj' }];

describe('aiguillage des commandes vers la jumelle Remote Control', () => {
  test('(a) envoyer vers une fiche tenue : la cse_ reçoit texte et pièces intacts', async () => {
    const { postes, recues } = postesSimules({ ok: true, donnees: {} });
    const api = sessions(postes, [TENUE, JUMELLE]);
    const r = await api.envoyer(requete('s1', { texte: 'Bonjour', pieces: PIECES }));
    expect(r.status).toBe(200);
    expect(recues).toEqual([
      {
        machine: 'portable',
        commande: { kind: 'envoyer', texte: 'Bonjour', pieces: PIECES, sessionId: 'cse_a' },
      },
    ]);
  });

  test('(b) envoyer sans jumelle : 409, message exact, rien envoyé au poste', async () => {
    const { postes, recues } = postesSimules({ ok: true, donnees: {} });
    const r = await sessions(postes, [TENUE]).envoyer(requete('s1', { texte: 'Bonjour' }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erreur: TEXTE_REFUS_SANS_JUMELLE });
    expect(recues).toHaveLength(0);
  });

  test('(c) interrompre suit l’aiguillage : vers la cse_ avec jumelle', async () => {
    const { postes, recues } = postesSimules({ ok: true, donnees: {} });
    const r = await sessions(postes, [TENUE, JUMELLE]).action(
      Object.assign(new Request('http://relais.test/api', { method: 'POST' }), {
        params: { id: 's1', action: 'interrompre' },
      }),
    );
    expect(r.status).toBe(200);
    expect(recues).toEqual([{ machine: 'portable', commande: { kind: 'interrompre', sessionId: 'cse_a' } }]);
  });

  test('(c) interrompre sans jumelle : 409, rien envoyé', async () => {
    const { postes, recues } = postesSimules({ ok: true, donnees: {} });
    const r = await sessions(postes, [TENUE]).action(
      Object.assign(new Request('http://relais.test/api', { method: 'POST' }), {
        params: { id: 's1', action: 'interrompre' },
      }),
    );
    expect(r.status).toBe(409);
    expect(recues).toHaveLength(0);
  });

  test('(d) fiche non terminale : chemin direct inchangé, même avec une cse_ de même conversation', async () => {
    const { postes, recues } = postesSimules({ ok: true, donnees: {} });
    const normale = fiche('s2', { terminal: false });
    await sessions(postes, [normale, JUMELLE]).envoyer(requete('s2', { texte: 'Salut' }));
    expect(recues).toEqual([{ machine: 'tour', commande: { kind: 'envoyer', texte: 'Salut', sessionId: 's2' } }]);
  });

  test('(d) autre action sur une fiche tenue : pas aiguillée, sans jumelle comme avec', async () => {
    const { postes, recues } = postesSimules({ ok: true, donnees: {} });
    const r = await sessions(postes, [TENUE]).autonomie(
      requete('s1', { active: true }),
    );
    expect(r.status).toBe(200);
    expect(recues).toEqual([{ machine: 'tour', commande: { kind: 'autonomie', active: true, sessionId: 's1' } }]);
  });
});
