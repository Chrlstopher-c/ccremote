import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { RegistreReunions } from './registre-reunions.ts';
import { type Resultat, SalleDeReunion } from './salle.ts';

const MAJ = '2026-11-15T10:00:00.000Z';

function session(id: string, titre: string, statut: ResumeSession['statut'] = 'attente'): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: `/mnt/${id}`, nom: id },
    cwd: `/mnt/${id}`,
    titre,
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
    creeLe: MAJ,
    majLe: MAJ,
  };
}

interface Banc {
  readonly salle: SalleDeReunion;
  readonly registre: Registre;
  readonly envoyes: { sessionId: string; texte: string }[];
  readonly diffusions: MessageClient[];
  readonly refusees: Set<string>;
}

function monter(limite = 20): Banc {
  const base = ouvrirBase(':memory:');
  const registre = new Registre(base);
  registre.enregistrerSession(session('atlas', 'Refonte du tableau'));
  registre.enregistrerSession(session('boreal', 'Facturation mensuelle'));
  registre.enregistrerSession(session('civil', 'Audit sécurité', 'fermee'));
  const envoyes: { sessionId: string; texte: string }[] = [];
  const diffusions: MessageClient[] = [];
  const refusees = new Set<string>();
  const postes: Pick<Postes, 'commander'> = {
    commander: (_machine, commande) => {
      if (commande.kind !== 'envoyer') return Promise.resolve({ ok: true });
      envoyes.push({ sessionId: commande.sessionId, texte: commande.texte });
      const horsLigne = refusees.has(commande.sessionId);
      const reponse: ReponsePoste = horsLigne ? { ok: false, erreur: 'hors ligne' } : { ok: true };
      return Promise.resolve(reponse);
    },
  };
  const salle = new SalleDeReunion({
    reunions: new RegistreReunions(base),
    registre,
    postes,
    diffusion: {
      diffuser: (m) => {
        diffusions.push(m);
      },
    },
    journal: pino({ enabled: false }),
    limite,
  });
  return { salle, registre, envoyes, diffusions, refusees };
}

function ok<T>(r: Resultat<T>): T {
  if (!r.ok) throw new Error(r.erreur);
  return r.valeur;
}

describe('demande explicite', () => {
  test('relayée à chaque destinataire par la commande du poste, persistée et diffusée', async () => {
    const b = monter();
    const r = ok(await b.salle.demander({ texte: 'Bonjour à tous', destinataires: ['atlas', 'boreal'] }));
    expect(b.envoyes.map((e) => e.sessionId)).toEqual(['atlas', 'boreal']);
    expect(b.envoyes[0]?.texte.startsWith('[Réunion — de l’utilisateur] Bonjour à tous')).toBe(true);
    expect(r.reunion.participants).toEqual(['atlas', 'boreal']);
    expect(r.reunion.messages[0]).toMatchObject({ auteur: 'chris', destinataires: ['atlas', 'boreal'] });
    expect(r.envois.every((e) => e.ok)).toBe(true);
    expect(b.diffusions.at(-1)).toEqual({ type: 'reunion', reunion: r.reunion });
  });

  test('une réunion existante se poursuit ; la limite de demandes de l’utilisateur est refusée (429)', async () => {
    const b = monter(2);
    const a = ok(await b.salle.demander({ texte: 'Premier', destinataires: ['atlas'] }));
    const c = ok(await b.salle.demander({ texte: 'Second', destinataires: ['atlas'], reunionId: a.reunion.id }));
    expect(c.reunion.messages.map((m) => m.texte)).toEqual(['Premier', 'Second']);
    const refus = await b.salle.demander({ texte: 'Troisième', destinataires: ['atlas'], reunionId: a.reunion.id });
    expect(refus).toEqual({ ok: false, statut: 429, erreur: 'limite de 2 demandes atteinte pour cette réunion' });
  });

  test('réunion inconnue : 404, rien relayé', async () => {
    const b = monter();
    const r = await b.salle.demander({ texte: 'x', destinataires: ['atlas'], reunionId: 'absente' });
    expect(r).toEqual({ ok: false, statut: 404, erreur: 'réunion inconnue' });
    expect(b.envoyes.length).toBe(0);
  });

  test('session fermée ou rangée : signalée, jamais relayée', async () => {
    const b = monter();
    b.registre.definirArchivee('boreal', true);
    const r = ok(await b.salle.demander({ texte: 'Hé', destinataires: ['civil', 'boreal', 'atlas'] }));
    expect(b.envoyes.map((e) => e.sessionId)).toEqual(['atlas']);
    expect(r.envois.filter((e) => !e.ok).map((e) => e.sessionId)).toEqual(['civil', 'boreal']);
  });

  test('aucune session destinataire joignable : 409', async () => {
    const b = monter();
    const r = await b.salle.demander({ texte: 'Hé', destinataires: ['civil'] });
    expect(r).toEqual({ ok: false, statut: 409, erreur: 'aucune session destinataire joignable' });
  });

  test('poste hors ligne : envoi signalé, et la session ne voit pas sa réponse recopiée', async () => {
    const b = monter();
    b.refusees.add('atlas');
    const r = ok(await b.salle.demander({ texte: 'Allô', destinataires: ['atlas'] }));
    expect(r.envois).toEqual([{ sessionId: 'atlas', ok: false, erreur: 'hors ligne' }]);
    b.salle.observer('atlas', { type: 'texte', texte: 'Présente' });
    expect(b.salle.ouvrir(r.reunion.id)?.messages.length).toBe(1);
  });
});

describe('destinataires automatiques', () => {
  test('routage par pertinence : seules les sessions dont le projet ou le titre est mentionné', async () => {
    const b = monter();
    const r = ok(await b.salle.demander({ texte: 'Question sur la facturation', destinataires: 'auto' }));
    expect(r.envois.map((e) => e.sessionId)).toEqual(['boreal']);
  });

  test('aucune session active : 409', async () => {
    const b = monter();
    b.registre.enregistrerSession(session('atlas', 'Refonte du tableau', 'fermee'));
    b.registre.enregistrerSession(session('boreal', 'Facturation mensuelle', 'fermee'));
    const r = await b.salle.demander({ texte: 'Allô', destinataires: 'auto' });
    expect(r).toEqual({ ok: false, statut: 409, erreur: 'aucune session active' });
  });
});

describe('réponses des sessions', () => {
  test('le fil principal d un tour est recopié, les textes du même tour s accumulent en un message', async () => {
    const b = monter();
    const r = ok(await b.salle.demander({ texte: 'Bonjour', destinataires: ['atlas'] }));
    b.salle.observer('atlas', { type: 'texte', texte: 'Premier bloc' });
    b.salle.observer('atlas', { type: 'texte', texte: 'Second bloc' });
    const lue = b.salle.ouvrir(r.reunion.id);
    expect(lue?.messages.length).toBe(2);
    const cumul = 'Premier bloc\n\nSecond bloc';
    expect(lue?.messages[1]).toMatchObject({ auteur: 'atlas', texte: cumul, destinataires: [] });
  });

  test('sous-agents, sessions non sollicitées et tours clos ne sont jamais recopiés', async () => {
    const b = monter();
    const r = ok(await b.salle.demander({ texte: 'Bonjour', destinataires: ['atlas'] }));
    b.salle.observer('atlas', { type: 'texte', texte: 'par un sous-agent', agent: 'toolu_1' });
    b.salle.observer('boreal', { type: 'texte', texte: 'pas sollicitée' });
    b.salle.observer('atlas', { type: 'texte', texte: 'Réponse' });
    b.salle.observer('atlas', { type: 'tour_fini', dureeMs: 1, contexte: 1 });
    b.salle.observer('atlas', { type: 'texte', texte: 'après la fin du tour' });
    expect(b.salle.ouvrir(r.reunion.id)?.messages.map((m) => m.texte)).toEqual(['Bonjour', 'Réponse']);
  });

  test('chaque demande suivie de sa réponse forme son propre tour', async () => {
    const b = monter();
    const r = ok(await b.salle.demander({ texte: 'Un', destinataires: ['atlas'] }));
    b.salle.observer('atlas', { type: 'texte', texte: 'A' });
    b.salle.observer('atlas', { type: 'tour_fini', dureeMs: 1, contexte: 1 });
    ok(await b.salle.demander({ texte: 'Deux', destinataires: ['atlas'], reunionId: r.reunion.id }));
    b.salle.observer('atlas', { type: 'texte', texte: 'B' });
    const auteurs = b.salle.ouvrir(r.reunion.id)?.messages.map((m) => `${m.auteur}:${m.texte}`);
    expect(auteurs).toEqual(['chris:Un', 'atlas:A', 'chris:Deux', 'atlas:B']);
  });

  test('une réponse recopiée est bornée à 2000 caractères', async () => {
    const b = monter();
    const r = ok(await b.salle.demander({ texte: 'Long', destinataires: ['atlas'] }));
    b.salle.observer('atlas', { type: 'texte', texte: 'y'.repeat(2500) });
    expect(b.salle.ouvrir(r.reunion.id)?.messages[1]?.texte.length).toBe(2000);
  });
});

describe('lecture', () => {
  test('la liste rend les réunions, une réunion inconnue rend null', async () => {
    const b = monter();
    const r = ok(await b.salle.demander({ texte: 'Bonjour', destinataires: ['atlas'] }));
    expect(b.salle.lister().map((x) => x.id)).toEqual([r.reunion.id]);
    expect(b.salle.ouvrir('absente')).toBeNull();
  });
});
