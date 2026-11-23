// Responsabilité : la politique des invités en unitaire — verdicts des requêtes et gestes, ouverture réécrite, vue des
// autres, arithmétique des parts, intentions. Pur sauf le dossier jetable de l'ouverture.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { MessageChiffre } from '../../commun/federation.ts';
import { reglagesParDefaut, type ReglagesInvite } from '../../commun/invites.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { ficheDe } from '../federation/banc-federation.ts';
import { ajouterEcart, consommeCourant } from './part.ts';
import { racineAcceptable, preparerOuverture, type CtxOuverture } from './ouverture.ts';
import { type CtxRequete, verdictRequete } from './politique-requete.ts';
import { type CtxGeste, type GesteRecu, verdictGeste } from './politique-geste.ts';
import { Intentions } from './intention.ts';
import { messageVuPar, sessionsLocalesVues, sessionsVues } from './vue.ts';
import { activiteDe } from './activite.ts';

const journal = pino({ enabled: false });
const G = 'aaaaaaaaaaaa';
const H = 'bbbbbbbbbbbb';
const MAJ = '2026-11-22T10:00:00.000Z';
let dossier: string;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'politique-'));
});
afterEach(() => rmSync(dossier, { recursive: true, force: true }));

function reglages(surcharge: Partial<ReglagesInvite> = {}): ReglagesInvite {
  return { ...reglagesParDefaut(null), modeles: { haiku: ['low', 'medium'] }, simultanees: 1, ...surcharge };
}

function session(id: string, membre: string | null, statut: ResumeSession['statut'] = 'attente'): ResumeSession {
  return {
    ...ficheDe(id, 'tour', id),
    statut,
    modele: 'haiku',
    ...(membre ? { invite: { membre, nom: 'Elie' } } : {}),
  };
}

function ctxReq(sessions: ResumeSession[], r: ReglagesInvite | null): CtxRequete {
  return {
    sessionDe: (id) => sessions.find((s) => s.id === id) ?? null,
    reglagesDe: (m) => (m === G ? r : null),
  };
}

const fil = (session: string): MessageChiffre => ({ t: 'fil', ref: 'r1', session });
const ecrire = (session: string): MessageChiffre => ({ t: 'ecrire', ref: 'r2', session, texte: 'salut' });

describe('requêtes', () => {
  const sessions = [session('g-1', G), session('h-1', H), session('libre', null)];

  test('un invité n’envoie rien au chef : ni lecture, ni écriture, ni ouverture', () => {
    const ctx = ctxReq(sessions, reglages());
    expect(verdictRequete(ctx, G, fil('g-1')).ok).toBe(false);
    expect(verdictRequete(ctx, G, ecrire('g-1')).ok).toBe(false);
    expect(verdictRequete(ctx, G, { t: 'ouvrir', ref: 'r', machine: 'x', chemin: '/x', message: 'a' }).ok).toBe(false);
  });

  test('un pair ordinaire ne lit ni n’écrit une session d’invité ; interrompre reste permis', () => {
    const chef = ctxReq(sessions, null);
    expect(verdictRequete(chef, 'cccccccccccc', fil('g-1')).ok).toBe(false);
    expect(verdictRequete(chef, 'cccccccccccc', ecrire('g-1')).ok).toBe(false);
    expect(verdictRequete(chef, 'cccccccccccc', fil('libre')).ok).toBe(true);
    expect(verdictRequete(chef, 'cccccccccccc', { t: 'interrompre', ref: 'r', session: 'g-1' }).ok).toBe(true);
  });
});

describe('gestes', () => {
  const sessions = [session('g-1', G, 'attente')];
  const ctx = (r: ReglagesInvite | null): CtxGeste => ({
    sessionDe: (id) => sessions.find((s) => s.id === id) ?? null,
    reglagesDe: (m) => (m === G ? r : null),
  });
  const geste = (suffixe: string, corps?: string, extra: Partial<GesteRecu> = {}): GesteRecu =>
    ({
      t: 'geste',
      ref: 'r',
      geste: suffixe,
      methode: 'POST',
      session: 'g-1',
      ...(corps !== undefined ? { corps } : {}),
      ...extra,
    }) as GesteRecu;

  test('un invité ne relaie aucun geste : tout passe par le relais Claude', () => {
    const c = ctx(reglages());
    expect(verdictGeste(c, G, geste('modele', '{"modele":"haiku"}')).ok).toBe(false);
    expect(verdictGeste(c, G, geste('effort', '{"effort":"low"}')).ok).toBe(false);
    expect(verdictGeste(c, G, geste('messages')).ok).toBe(false);
    expect(verdictGeste(c, G, geste('ouvrir', '{}', { session: undefined, machine: 'tour' })).ok).toBe(false);
  });

  test('un pair ordinaire ne touche pas le contenu d’une session d’invité ; interrompre reste permis', () => {
    const c = ctx(null);
    expect(verdictGeste(c, 'cccccccccccc', geste('fichiers', '{}')).ok).toBe(false);
    expect(verdictGeste(c, 'cccccccccccc', geste('interrompre', '{}')).ok).toBe(true);
  });
});

describe('ouverture par l’invité', () => {
  const base = (): CtxOuverture => ({
    machineRelais: 'dddddddddddd',
    machine: 'tour',
    reglages: reglages({ prompt: 'Réponds court.', machines: ['dddddddddddd'] }),
    nom: 'Elie',
    compteDeMoi: null,
    compteSurSaMachine: false,
    sessionsEnCours: 0,
    consomme5h: null,
    consommeSemaine: null,
    racines: ['/projets'],
    racine: join(dossier, 'espaces'),
    home: '/home/utilisateur',
  });

  test('les dossiers sensibles ne servent jamais d’espace', () => {
    expect(racineAcceptable('/home/utilisateur/.config/x', '/home/utilisateur')).toBe(false);
    expect(racineAcceptable('/home/utilisateur/.claude', '/home/utilisateur')).toBe(false);
    expect(racineAcceptable('/home/utilisateur/lanterne-invites', '/home/utilisateur')).toBe(true);
  });

  test('le corps de l’invité est réécrit : espace, mode choisi gardé, sans bac à sable, cadre posé', () => {
    const r = preparerOuverture(
      base(),
      G,
      JSON.stringify({
        message: 'bonjour',
        modele: 'haiku',
        effort: 'low',
        mode: 'bypassPermissions',
        bac_a_sable: 'oui',
        machine: 'autre',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Décision du 23/11 : la session tourne sur sa machine, l'invité garde le mode choisi (Manuel par défaut).
    expect(r.corps['mode']).toBe('bypassPermissions');
    const sansMode = preparerOuverture(base(), G, JSON.stringify({ message: 'x', modele: 'haiku', effort: 'low' }));
    expect(sansMode.ok && sansMode.corps['mode']).toBe('default');
    expect('bac_a_sable' in r.corps).toBe(false);
    expect(r.corps['machine']).toBe('tour');
    expect(String((r.corps['projet'] as { chemin: string }).chemin).startsWith(join(dossier, 'espaces', G))).toBe(true);
    expect(r.cadre.prompt).toBe('Réponds court.');
    expect(r.cadre.lecture).toEqual([]);
  });

  test('modèle non permis : refusé avant tout dossier', () => {
    const r = preparerOuverture(base(), G, JSON.stringify({ message: 'x', modele: 'opus' }));
    expect(r.ok).toBe(false);
  });
});

describe('vue des autres', () => {
  const sessions = [session('g-1', G), session('libre', null)];
  const fiche: ResumeSession[] = sessions.map((s) => s);

  test('un invité ne voit aucune session du chef ; un autre voit l’invité masqué', () => {
    expect(sessionsVues(G, reglages(), fiche)).toEqual([]);
    const vue = sessionsVues('cccccccccccc', null, fiche);
    expect(vue.find((s) => s.id === 'g-1')?.titre).toBe('Conversation de Elie');
    expect(vue.find((s) => s.id === 'libre')?.titre).toBe('libre');
  });

  test('sur sa propre machine, l’invité voit ses sessions (terminal, fichiers) ; jamais celles des autres', () => {
    expect(sessionsLocalesVues(G, reglages(), fiche).map((s) => s.id)).toEqual(['g-1']);
    expect(sessionsLocalesVues(H, reglages(), fiche)).toEqual([]);
    expect(sessionsLocalesVues(H, null, fiche).find((s) => s.id === 'g-1')?.titre).toBe('Conversation de Elie');
  });

  test('les événements et le flux d’une session d’invité ne partent pas vers l’appli du chef', () => {
    const lookup = (id: string): ResumeSession | null => fiche.find((s) => s.id === id) ?? null;
    expect(messageVuPar('cccccccccccc', { type: 'flux', sessionId: 'g-1', bloc: 'b', delta: 'x' }, lookup)).toBeNull();
    expect(messageVuPar(G, { type: 'flux', sessionId: 'g-1', bloc: 'b', delta: 'x' }, lookup)).not.toBeNull();
  });
});

describe('parts et activité', () => {
  test('écart d’un tour : après − avant, borné à 0 ; une nouvelle fenêtre repart de 0', () => {
    const avant = { pourcent: 10, reinitialiseLe: 'R1' };
    const f = ajouterEcart({ cle: 'R1', consomme: 2 }, avant as never, { pourcent: 15, reinitialiseLe: 'R1' } as never);
    expect(f.consomme).toBe(7);
    const neuve = ajouterEcart({ cle: 'R0', consomme: 20 }, null, { pourcent: 4, reinitialiseLe: 'R2' } as never);
    expect(neuve).toEqual({ cle: 'R2', consomme: 4 });
    expect(consommeCourant({ cle: 'R1', consomme: 9 }, { reinitialiseLe: 'R2' } as never)).toBe(0);
    expect(consommeCourant({ cle: 'R1', consomme: 9 }, null)).toBeNull();
  });

  test('activité : sessions du jour, en cours, part', () => {
    const a = activiteDe({
      reglages: reglages(),
      compteurs: {
        session: { cle: null, consomme: 0 },
        semaine: { cle: null, consomme: 0 },
        jours: { '2026-11-22': { sessions: 2, jetons: 10.4, derniere: MAJ, requetes: 3, modele: 'haiku' } },
      },
      enCours: 1,
      jour: '2026-11-22',
      releves: null,
    });
    expect(a).toMatchObject({ actifAujourdhui: true, sessionsAujourdhui: 2, sessionsEnCours: 1, jetonsAujourdhui: 10 });
    expect(a).toMatchObject({ requetesAujourdhui: 3, dernierModele: 'haiku' });
    expect(a.part5h?.part).toBe(25);
  });
});

describe('intentions d’invitation', () => {
  test('une intention se prend une fois, et expire', () => {
    let t = 1000;
    const i = new Intentions(join(dossier, 'intentions.json'), journal, () => t);
    i.pose(H, reglages(), 500);
    t = 1200;
    expect(i.prendre(H)).not.toBeNull();
    expect(i.prendre(H)).toBeNull();
    i.pose(G, reglages(), 100);
    t = 5000;
    expect(i.prendre(G)).toBeNull();
  });
});
