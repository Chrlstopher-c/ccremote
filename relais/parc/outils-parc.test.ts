// Responsabilité : tests des outils du parc côté relais — chaque opération rend ce que rend la route HTTP
// correspondante, refus lisibles, arguments invalides refusés, opération hors liste refusée, réveil injecté (aucune
// trame n'est envoyée). Le poste est factice (il répond aux commandes du relais) ; le registre est en mémoire.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import { MessagePoste } from '../../commun/protocole-poste.ts';
import { ResumeSession } from '../../commun/session.ts';
import { ApiSessions } from '../clients/api-sessions.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { erreur, json } from '../clients/http.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { type DonneesPoste, Postes } from './postes.ts';
import { type DependancesOutilsParc, estOperationParc, traiterRequeteParc } from './outils-parc.ts';

const MAJ = '2026-11-22T10:00:00.000Z';
const journal = pino({ enabled: false });

interface CommandeRecue {
  readonly kind: string;
  readonly id: string;
  readonly [cle: string]: unknown;
}

interface Banc {
  readonly outils: DependancesOutilsParc;
  readonly registre: Registre;
  readonly recues: CommandeRecue[];
  readonly reveils: string[];
}

function session(id: string, machine: string, statut: string, terminal = false): ResumeSession {
  return ResumeSession.parse({
    id,
    machine,
    projet: { machine, chemin: '/mnt/projects/p', nom: 'p' },
    cwd: '/mnt/projects/p',
    titre: `Titre ${id}`,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut,
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    terminal,
    creeLe: MAJ,
    majLe: MAJ,
  });
}

/** Le relais avec un poste « tour » connecté, qui répond `reponse` à chaque commande reçue. */
function banc(reponse: { ok: boolean; erreur?: string; donnees?: unknown } = { ok: true, donnees: {} }): Banc {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  registre.enregistrerMachine({
    id: 'tour',
    description: 'Tour',
    racines: [],
    projets: [],
    comptes: ['defaut'],
    version: 'test',
    derniereVue: MAJ,
  });
  registre.enregistrerMachine({
    id: 'portable',
    description: 'Portable',
    racines: [],
    projets: [],
    comptes: ['defaut'],
    version: 'test',
    derniereVue: MAJ,
  });
  const diffusion = new Diffusion();
  const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
  const recues: CommandeRecue[] = [];
  const poste = {
    data: { machine: 'tour' },
    send: (texte: string) => {
      const c = JSON.parse(texte) as CommandeRecue;
      recues.push(c);
      postes.recu(poste, JSON.stringify({ kind: 'reponse', id: c.id, ...reponse }));
    },
  } as unknown as ServerWebSocket<DonneesPoste>;
  postes.ouvert(poste);
  const reveils: string[] = [];
  const entretien = {
    reveiller: async (id: string): Promise<Response> => {
      if (id !== 'portable') return erreur(`${id} ne se réveille pas à distance`, 404);
      reveils.push(id);
      return json({ ok: true, par: 'relais' });
    },
    reveilPossibles: (): string[] => ['portable'],
  };
  const sessions = new ApiSessions(registre, postes, diffusion, new Set(), journal);
  const outils: DependancesOutilsParc = { postes, registre, sessions, entretien, journal };
  return { outils, registre, recues, reveils };
}

describe('opérations du parc : liste blanche', () => {
  test('seules les opérations du parc sont reconnues', () => {
    expect(estOperationParc('parc_fil')).toBe(true);
    expect(estOperationParc('parc_supprimer')).toBe(false);
    expect(estOperationParc('module_appeler')).toBe(false);
  });

  test('le protocole poste → relais refuse une opération hors liste', () => {
    const hors = { kind: 'requete_relais', id: 'x', quoi: 'parc_supprimer', args: {} };
    expect(MessagePoste.safeParse(hors).success).toBe(false);
    const en = { kind: 'requete_relais', id: 'x', quoi: 'parc_fil', args: { session: 's' } };
    expect(MessagePoste.safeParse(en).success).toBe(true);
  });
});

describe('parc_machines', () => {
  test('machines du relais, en ligne ou non, avec le réveil possible', async () => {
    const { outils } = banc();
    const r = await traiterRequeteParc(outils, 'parc_machines', {});
    expect(r).toEqual({
      ok: true,
      donnees: {
        machines: [
          { id: 'portable', description: 'Portable', enLigne: false, reveilPossible: true },
          { id: 'tour', description: 'Tour', enLigne: true, reveilPossible: false },
        ],
      },
    });
  });
});

describe('parc_sessions', () => {
  test('vivantes par défaut, filtre par machine, fermées avec toutes', async () => {
    const { outils, registre } = banc();
    registre.enregistrerSession(session('s-tour', 'tour', 'travail'));
    registre.enregistrerSession(session('s-fermee', 'tour', 'fermee'));
    registre.enregistrerSession(session('s-portable', 'portable', 'attente'));
    const ids = async (args: unknown): Promise<string[]> => {
      const r = await traiterRequeteParc(outils, 'parc_sessions', args);
      const sessions = (r.donnees as { sessions: { id: string }[] }).sessions;
      return sessions.map((s) => s.id).sort();
    };
    expect(await ids({})).toEqual(['s-portable', 's-tour']);
    expect(await ids({ machine: 'tour' })).toEqual(['s-tour']);
    expect(await ids({ toutes: true })).toEqual(['s-fermee', 's-portable', 's-tour']);
  });

  test('chaque session porte son identifiant, son titre, son statut et son dialogue en attente', async () => {
    const { outils, registre } = banc();
    registre.enregistrerSession(session('s-tour', 'tour', 'question'));
    const r = await traiterRequeteParc(outils, 'parc_sessions', {});
    expect(r.donnees).toEqual({
      sessions: [
        {
          id: 's-tour',
          machine: 'tour',
          titre: 'Titre s-tour',
          projet: 'p',
          statut: 'question',
          majLe: MAJ,
          terminal: false,
          dialogue: null,
        },
      ],
    });
  });

  test('arguments invalides : refus sans rien lire', async () => {
    const { outils } = banc();
    const r = await traiterRequeteParc(outils, 'parc_sessions', { machine: 'Tour Maj!' });
    expect(r.ok).toBe(false);
    expect(r.erreur).toContain('arguments invalides');
  });
});

describe('parc_fil', () => {
  test('rend les derniers événements, bornés par `limite`', async () => {
    const { outils, registre } = banc();
    registre.enregistrerSession(session('s-tour', 'tour', 'attente'));
    for (const n of [1, 2, 3, 4, 5]) registre.ajouterEvenement('s-tour', MAJ, { type: 'message', texte: `m${n}` });
    const r = await traiterRequeteParc(outils, 'parc_fil', { session: 's-tour', limite: 3 });
    expect(r.ok).toBe(true);
    const textes = (r.donnees as { evt: { texte: string } }[]).map((e) => e.evt.texte);
    expect(textes).toEqual(['m3', 'm4', 'm5']);
  });

  test('session inconnue : refus lisible', async () => {
    const { outils } = banc();
    const r = await traiterRequeteParc(outils, 'parc_fil', { session: 'absente' });
    expect(r).toEqual({ ok: false, erreur: 'session inconnue' });
  });
});

describe('parc_envoyer', () => {
  test('le message part au poste de la session, comme un envoi de la route', async () => {
    const { outils, registre, recues } = banc();
    registre.enregistrerSession(session('s-tour', 'tour', 'attente'));
    const r = await traiterRequeteParc(outils, 'parc_envoyer', { session: 's-tour', texte: 'bonjour' });
    expect(r.ok).toBe(true);
    expect(recues).toContainEqual(expect.objectContaining({ kind: 'envoyer', texte: 'bonjour', sessionId: 's-tour' }));
  });

  test('session tenue ailleurs sans Remote Control : refus lisible, rien n’est envoyé', async () => {
    const { outils, registre, recues } = banc();
    registre.enregistrerSession(session('s-desktop', 'tour', 'attente', true));
    const r = await traiterRequeteParc(outils, 'parc_envoyer', { session: 's-desktop', texte: 'bonjour' });
    expect(r.ok).toBe(false);
    expect(r.erreur).toContain('Remote Control');
    expect(recues.filter((c) => c.kind === 'envoyer')).toHaveLength(0);
  });

  test('texte vide : refus avant tout appel', async () => {
    const { outils, registre, recues } = banc();
    registre.enregistrerSession(session('s-tour', 'tour', 'attente'));
    const r = await traiterRequeteParc(outils, 'parc_envoyer', { session: 's-tour', texte: '' });
    expect(r.ok).toBe(false);
    expect(recues).toHaveLength(0);
  });
});

describe('parc_repondre', () => {
  test('l’option choisie part au dialogue de la session', async () => {
    const { outils, registre, recues } = banc();
    registre.enregistrerSession(session('s-tour', 'tour', 'question'));
    const r = await traiterRequeteParc(outils, 'parc_repondre', { session: 's-tour', dialogue: 'd1', index: 1 });
    expect(r.ok).toBe(true);
    expect(recues).toContainEqual(expect.objectContaining({ kind: 'repondre', reponse: { id: 'd1', index: 1 } }));
  });

  test('ni option ni texte : refus avant tout appel', async () => {
    const { outils, registre, recues } = banc();
    registre.enregistrerSession(session('s-tour', 'tour', 'question'));
    const r = await traiterRequeteParc(outils, 'parc_repondre', { session: 's-tour', dialogue: 'd1' });
    expect(r.ok).toBe(false);
    expect(recues).toHaveLength(0);
  });
});

describe('parc_ouvrir', () => {
  test('crée la session sur la machine et le dossier donnés', async () => {
    const { outils, recues } = banc({ ok: true, donnees: { id: 's-neuve', machine: 'tour' } });
    const r = await traiterRequeteParc(outils, 'parc_ouvrir', {
      machine: 'tour',
      dossier: '/mnt/projects/p',
      message: 'Fais X',
    });
    expect(r).toEqual({ ok: true, donnees: { id: 's-neuve', machine: 'tour' } });
    expect(recues).toContainEqual(
      expect.objectContaining({
        kind: 'ouvrir',
        demande: expect.objectContaining({
          projet: { machine: 'tour', chemin: '/mnt/projects/p', nom: 'p' },
          message: 'Fais X',
        }),
      }),
    );
  });

  test('dossier relatif : refus avant tout appel', async () => {
    const { outils, recues } = banc();
    const args = { machine: 'tour', dossier: 'mnt/p', message: 'X' };
    const r = await traiterRequeteParc(outils, 'parc_ouvrir', args);
    expect(r.ok).toBe(false);
    expect(recues).toHaveLength(0);
  });

  test('refus du poste lisible au relais', async () => {
    const { outils } = banc({ ok: false, erreur: 'tour n’a pas répondu' });
    const args = { machine: 'tour', dossier: '/mnt/projects/p', message: 'X' };
    const r = await traiterRequeteParc(outils, 'parc_ouvrir', args);
    expect(r).toEqual({ ok: false, erreur: 'tour n’a pas répondu' });
  });
});

describe('parc_reveiller', () => {
  test('réveille une machine connue par la fonction de réveil, sans trame réelle', async () => {
    const { outils, reveils } = banc();
    const r = await traiterRequeteParc(outils, 'parc_reveiller', { machine: 'portable' });
    expect(r).toEqual({ ok: true, donnees: { ok: true, par: 'relais' } });
    expect(reveils).toEqual(['portable']);
  });

  test('machine sans réveil configuré : refus lisible', async () => {
    const { outils, reveils } = banc();
    const r = await traiterRequeteParc(outils, 'parc_reveiller', { machine: 'inconnue' });
    expect(r).toEqual({ ok: false, erreur: 'inconnue ne se réveille pas à distance' });
    expect(reveils).toHaveLength(0);
  });

  test('identifiant de machine mal formé : refus avant tout appel', async () => {
    const { outils, reveils } = banc();
    const r = await traiterRequeteParc(outils, 'parc_reveiller', { machine: '../tour' });
    expect(r.ok).toBe(false);
    expect(reveils).toHaveLength(0);
  });
});

describe('arguments non-objet', () => {
  test('un argument qui n’est pas un objet est refusé pour toute opération', async () => {
    const { outils } = banc();
    const r = await traiterRequeteParc(outils, 'parc_fil', null);
    expect(r.ok).toBe(false);
  });
});
