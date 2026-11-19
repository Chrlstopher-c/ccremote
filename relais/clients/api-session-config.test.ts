import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { Diffusion } from './diffusion.ts';
import { ApiSessionConfig } from './api-session-config.ts';
import { ApiSessions } from './api-sessions.ts';

const journal = pino({ enabled: false });
const MAJ = '2026-11-19T10:00:00.000Z';

function fiche(id: string, machine: string, extra: Partial<ResumeSession> = {}): ResumeSession {
  return {
    id,
    machine,
    projet: { machine, chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: `Titre ${id}`,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'fermee',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: id,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
    ...extra,
  };
}

type Recue = { machine: string; commande: Record<string, unknown> };

function postesSimules(reponse: ReponsePoste | ((c: Record<string, unknown>) => ReponsePoste)) {
  const recues: Recue[] = [];
  const postes = {
    commander: (machine: string, commande: Record<string, unknown>) => {
      recues.push({ machine, commande });
      return Promise.resolve(typeof reponse === 'function' ? reponse(commande) : reponse);
    },
    vues: () => [],
    decouvertes: () => [],
  } as unknown as Postes;
  return { postes, recues };
}

function registreAvec(...fiches: ResumeSession[]): Registre {
  const registre = new Registre(ouvrirBase(':memory:'));
  for (const f of fiches) registre.enregistrerSession(f);
  return registre;
}

function requete(id: string, opts: { corps?: unknown; methode?: string; params?: Record<string, string> } = {}) {
  const init: RequestInit = { method: opts.methode ?? 'POST' };
  if (opts.corps !== undefined) init.body = JSON.stringify(opts.corps);
  return Object.assign(new Request('http://relais.test/api', init), { params: { id, ...opts.params } });
}

describe('réglages de session via le poste', () => {
  test('style : commande relayée avec l’identifiant, valeur nulle acceptée', async () => {
    const { postes, recues } = postesSimules({ ok: true, donnees: { style_sortie: null } });
    const api = new ApiSessionConfig(registreAvec(fiche('s1', 'tour')), postes);
    const r = await api.style(requete('s1', { corps: { style: null } }));
    expect(r.status).toBe(200);
    expect(recues[0]).toEqual({ machine: 'tour', commande: { kind: 'style', style: null, sessionId: 's1' } });
  });

  test('styles disponibles : lecture relayée', async () => {
    const { postes, recues } = postesSimules({ ok: true, donnees: { actuel: 'default', disponibles: ['default'] } });
    const api = new ApiSessionConfig(registreAvec(fiche('s1', 'tour')), postes);
    expect(await (await api.styles(requete('s1', { methode: 'GET' }))).json()).toEqual({
      actuel: 'default',
      disponibles: ['default'],
    });
    expect(recues[0]?.commande).toEqual({ kind: 'styles', sessionId: 's1' });
  });

  test('connecteur : nom décodé de l’URL, session arrêtée rendue en 409', async () => {
    const { postes, recues } = postesSimules({ ok: false, erreur: 'session arrêtée' });
    const api = new ApiSessionConfig(registreAvec(fiche('s1', 'tour')), postes);
    const r = await api.connecteur(requete('s1', { corps: { actif: false }, params: { nom: 'claude.ai%20Gmail' } }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erreur: 'session arrêtée' });
    expect(recues[0]?.commande).toEqual({ kind: 'connecteur', nom: 'claude.ai Gmail', actif: false, sessionId: 's1' });
  });

  test('session inconnue : 404 sans appel au poste', async () => {
    const { postes, recues } = postesSimules({ ok: true });
    const api = new ApiSessionConfig(registreAvec(), postes);
    expect((await api.style(requete('absente', { corps: { style: 'Learning' } }))).status).toBe(404);
    expect(recues.length).toBe(0);
  });
});

describe('conversations annexes', () => {
  test('liste lue au registre : seulement celles de la parente, triées par date', async () => {
    const registre = registreAvec(
      fiche('p', 'tour'),
      fiche('a2', 'tour', { annexe_de: 'p', titre: 'Conversation annexe', creeLe: '2026-11-19T12:00:00.000Z' }),
      fiche('a1', 'tour', { annexe_de: 'p', titre: 'Conversation annexe', creeLe: '2026-11-19T11:00:00.000Z' }),
      fiche('autre', 'tour', { annexe_de: 'ailleurs' }),
    );
    const api = new ApiSessionConfig(registre, postesSimules({ ok: true }).postes);
    const liste = await (await api.annexes(requete('p', { methode: 'GET' }))).json();
    expect(liste).toEqual([
      { id: 'a1', titre: 'Conversation annexe', cree_le: '2026-11-19T11:00:00.000Z' },
      { id: 'a2', titre: 'Conversation annexe', cree_le: '2026-11-19T12:00:00.000Z' },
    ]);
  });

  test('création : 201 avec l’identifiant rendu par le poste', async () => {
    const { postes, recues } = postesSimules({ ok: true, donnees: { id: 'copie-1' } });
    const api = new ApiSessionConfig(registreAvec(fiche('p', 'tour')), postes);
    const r = await api.annexer(requete('p'));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ id: 'copie-1' });
    expect(recues[0]?.commande).toEqual({ kind: 'annexer', sessionId: 'p' });
  });

  test('une annexe n’a pas d’annexe : 400, aucun appel', async () => {
    const { postes, recues } = postesSimules({ ok: true });
    const api = new ApiSessionConfig(registreAvec(fiche('a', 'tour', { annexe_de: 'p' })), postes);
    expect((await api.annexer(requete('a'))).status).toBe(400);
    expect(recues.length).toBe(0);
  });
});

describe('création et suppression côté relais', () => {
  function sessions(postes: Postes, registre: Registre): ApiSessions {
    return new ApiSessions(registre, postes, new Diffusion(), new Set(), journal);
  }

  test('ouverture : style, bac à sable et Remote Control transmis au poste ; défauts sinon', async () => {
    const { postes, recues } = postesSimules({ ok: true, donnees: {} });
    const corps = {
      machine: 'tour',
      projet: { machine: 'tour', chemin: '/p', nom: 'p' },
      message: 'bonjour',
      style_sortie: 'Learning',
      bac_a_sable: 'strict',
      controle_distant: true,
    };
    await sessions(postes, registreAvec()).ouvrir(
      new Request('http://r/api', { method: 'POST', body: JSON.stringify(corps) }),
    );
    const demande = (recues[0]?.commande['demande'] ?? {}) as Record<string, unknown>;
    expect([demande['style_sortie'], demande['bac_a_sable'], demande['controle_distant']]).toEqual([
      'Learning',
      'strict',
      true,
    ]);
    await sessions(postes, registreAvec()).ouvrir(
      new Request('http://r/api', {
        method: 'POST',
        body: JSON.stringify({
          ...corps,
          style_sortie: undefined,
          bac_a_sable: undefined,
          controle_distant: undefined,
        }),
      }),
    );
    const defaut = (recues[1]?.commande['demande'] ?? {}) as Record<string, unknown>;
    expect([defaut['style_sortie'], defaut['bac_a_sable'], defaut['controle_distant']]).toEqual([null, 'non', false]);
  });

  test('pièces du premier message : transmises au poste ; plus de trois : refusées sans appel', async () => {
    const { postes, recues } = postesSimules({ ok: true, donnees: {} });
    const base = { machine: 'tour', projet: { machine: 'tour', chemin: '/p', nom: 'p' }, message: 'bonjour' };
    const piece = { nom: 'note.txt', mime: 'text/plain', base64: 'aGk=' };
    await sessions(postes, registreAvec()).ouvrir(
      new Request('http://r/api', { method: 'POST', body: JSON.stringify({ ...base, pieces: [piece] }) }),
    );
    const demande = (recues[0]?.commande['demande'] ?? {}) as Record<string, unknown>;
    expect(demande['pieces']).toEqual([piece]);
    const trop = await sessions(postes, registreAvec()).ouvrir(
      new Request('http://r/api', {
        method: 'POST',
        body: JSON.stringify({ ...base, pieces: [piece, piece, piece, piece] }),
      }),
    );
    expect(trop.status).toBe(400);
    expect(recues.length).toBe(1);
  });

  test('suppression de la parente : ses annexes partent du poste puis du registre', async () => {
    const registre = registreAvec(fiche('p', 'tour'), fiche('a', 'tour', { annexe_de: 'p' }), fiche('autre', 'tour'));
    const { postes, recues } = postesSimules({ ok: true });
    const r = await sessions(postes, registre).supprimer(requete('p'));
    expect(r.status).toBe(200);
    expect(recues.map((x) => x.commande['sessionId'])).toEqual(['p', 'a']);
    expect(registre.session('a')).toBeNull();
    expect(registre.session('autre')).not.toBeNull();
  });
});
