// Matrice « une conversation, une entrée » : chaque origine d'une conversation (Lanterne SDK, tmux, Desktop, terminal,
// claude.ai, duo, machine fédérée) et chaque passage de l'une à l'autre (Remote Control activé ou coupé, reprise,
// rangement) doit laisser exactement une entrée visible, à sa place. Fixtures seulement.
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import { ResumeSession, type StatutSession } from '../../commun/session.ts';
import { ApiSessions } from '../clients/api-sessions.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { cibleConversation, membresConversation, planDoublons } from './doublons-conversation.ts';
import { Doublons } from './doublons.ts';
import type { Postes } from './postes.ts';

const MAJ = '2026-11-22T10:00:00.000Z';
const T = (h: number): string => `2026-11-22T${String(h).padStart(2, '0')}:00:00.000Z`;

interface Opts {
  readonly statut?: StatutSession;
  readonly archivee?: boolean;
  readonly majLe?: string;
  readonly machine?: string;
  readonly duo?: boolean;
}

// Fiche de poste : sdk (Lanterne), tmux (Lanterne avec Remote Control), ou terminal (Desktop, `claude` tapé).
function poste(
  id: string,
  conversation: string | null,
  moteur: 'sdk' | 'tmux' | 'terminal',
  o: Opts = {},
): ResumeSession {
  return ResumeSession.parse({
    id,
    machine: o.machine ?? 'tour',
    projet: { machine: o.machine ?? 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: id,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: o.statut ?? 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: conversation,
    tmux: null,
    attachee: false,
    pilotee: false,
    moteur: moteur === 'terminal' ? 'tmux' : moteur,
    ...(moteur === 'terminal' ? { terminal: true } : {}),
    ...(o.duo ? { duo: { pair: 'marc', niveau: 'lecture' as const } } : {}),
    archivee: o.archivee ?? false,
    creeLe: MAJ,
    majLe: o.majLe ?? MAJ,
  });
}

// Session Remote Control (`cse_…`) rattachée à une conversation ; `conversation` absente = pas encore rattachée.
function rc(id: string, conversation: string | undefined, o: Opts & { connectee?: boolean } = {}): ResumeSession {
  const connectee = o.connectee ?? true;
  return ResumeSession.parse({
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: 'Remote Control', nom: 'Remote Control' },
    cwd: 'Remote Control',
    titre: id,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: connectee ? (o.statut ?? 'attente') : 'fermee',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    moteur: 'claude_ai',
    distant: {
      compte: 'defaut',
      idDistant: id,
      connexion: connectee ? 'connectee' : 'deconnectee',
      probleme: null,
      conversation,
    },
    archivee: o.archivee ?? false,
    creeLe: MAJ,
    majLe: o.majLe ?? MAJ,
  });
}

/** Identifiants des entrées visibles (non masquées) après rapprochement. */
function visibles(fiches: readonly ResumeSession[]): string[] {
  const plan = planDoublons(fiches);
  return fiches.map((f) => f.id).filter((id) => !plan.masquees.has(id));
}

describe('origines d’une conversation : une entrée, la fiche de poste', () => {
  test('créée dans Lanterne (SDK), sans Remote Control : une fiche', () => {
    expect(visibles([poste('s-sdk', 'conv-1', 'sdk')])).toEqual(['s-sdk']);
  });

  test('créée dans Lanterne (SDK) puis Remote Control activé (tmux + jumelle) : la fiche de poste reste', () => {
    const fiches = [poste('s-tmux', 'conv-1', 'tmux'), rc('cse_1', 'conv-1')];
    expect(visibles(fiches)).toEqual(['s-tmux']);
    expect(cibleConversation(fiches, 'cse_1')).toBe('s-tmux');
  });

  test('lancée dans Claude Desktop sans Remote Control : une fiche terminal', () => {
    expect(visibles([poste('s-desk', 'conv-2', 'terminal')])).toEqual(['s-desk']);
  });

  test('lancée dans Claude Desktop avec Remote Control : la fiche terminal reste, la jumelle est masquée', () => {
    const fiches = [poste('s-desk', 'conv-2', 'terminal'), rc('cse_2', 'conv-2')];
    expect(visibles(fiches)).toEqual(['s-desk']);
  });

  test('lancée dans un terminal avec `claude`, Remote Control coupé ensuite : la fiche de poste seule', () => {
    const fiches = [poste('s-term', 'conv-3', 'terminal'), rc('cse_3', 'conv-3', { connectee: false })];
    expect(visibles(fiches)).toEqual(['s-term']);
  });

  test('ouverte depuis claude.ai ou le téléphone (session claude_ai seule) : une entrée, la jumelle', () => {
    expect(visibles([rc('cse_phone', 'conv-4')])).toEqual(['cse_phone']);
  });

  test('claude.ai sur une conversation tenue par Lanterne : la fiche de poste reste', () => {
    const fiches = [rc('cse_phone', 'conv-5'), poste('s-sdk', 'conv-5', 'sdk')];
    expect(visibles(fiches)).toEqual(['s-sdk']);
  });

  test('session du duo vue chez le pair (copie + Remote Control du pair) : la copie cède au Remote Control', () => {
    const fiches = [poste('s-duo', 'conv-6', 'sdk', { duo: true, machine: 'marc' }), rc('cse_6', 'conv-6')];
    expect(visibles(fiches)).toEqual(['cse_6']);
  });

  test('copie du duo seule : une entrée', () => {
    expect(visibles([poste('s-duo', 'conv-7', 'sdk', { duo: true, machine: 'marc' })])).toEqual(['s-duo']);
  });

  test('machine fédérée vue par deux chemins (même conversation, deux fiches) : une entrée', () => {
    const fiches = [
      poste('s-fed-a', 'conv-8', 'sdk', { machine: 'pi', majLe: T(9) }),
      poste('s-fed-b', 'conv-8', 'sdk', { machine: 'pi', majLe: T(11) }),
    ];
    expect(visibles(fiches)).toEqual(['s-fed-b']);
  });

  test('deux conversations voisines ne se mélangent jamais', () => {
    const fiches = [
      poste('s-a', 'conv-a', 'sdk'),
      rc('cse_a', 'conv-a'),
      poste('s-b', 'conv-b', 'tmux'),
      rc('cse_b', 'conv-b'),
    ];
    expect(visibles(fiches).sort()).toEqual(['s-a', 's-b']);
  });
});

describe('passages d’une conversation à l’autre : une entrée à chaque étape', () => {
  test('Remote Control coupé puis réactivé sur une fiche pilotée : deux jumelles, une entrée', () => {
    const fiches = [
      poste('s-tmux', 'conv-9', 'tmux'),
      rc('cse_old', 'conv-9', { connectee: false, majLe: T(8) }),
      rc('cse_new', 'conv-9', { majLe: T(11) }),
    ];
    expect(visibles(fiches)).toEqual(['s-tmux']);
  });

  test('reprise par Lanterne d’une conversation tenue par un terminal : la fiche fermée cède', () => {
    const fiches = [
      poste('s-term', 'conv-10', 'terminal', { statut: 'fermee', majLe: T(8) }),
      poste('s-sdk', 'conv-10', 'sdk', { majLe: T(10) }),
    ];
    expect(visibles(fiches)).toEqual(['s-sdk']);
  });

  test('`claude --resume` dans un terminal d’une session créée dans Lanterne : la nouvelle fiche prime', () => {
    const fiches = [
      poste('s-sdk', 'conv-11', 'sdk', { statut: 'fermee', majLe: T(8) }),
      poste('s-term', 'conv-11', 'terminal', { majLe: T(10) }),
    ];
    expect(visibles(fiches)).toEqual(['s-term']);
    expect(membresConversation(fiches, 's-sdk').sort()).toEqual(['s-sdk', 's-term']);
  });

  test('`claude --resume` avec Remote Control déjà ouvert sur l’ancienne fiche : une entrée, la vivante', () => {
    const fiches = [
      poste('s-old', 'conv-12', 'tmux', { statut: 'fermee', majLe: T(8) }),
      poste('s-new', 'conv-12', 'terminal', { majLe: T(10) }),
      rc('cse_12', 'conv-12', { majLe: T(9) }),
    ];
    expect(visibles(fiches)).toEqual(['s-new']);
  });

  test('fiche de poste rangée : la jumelle vivante reprend la place, les deux restent liées', () => {
    const fiches = [poste('s-tmux', 'conv-13', 'tmux', { archivee: true }), rc('cse_13', 'conv-13')];
    expect(visibles(fiches)).toEqual(['cse_13']);
    expect(cibleConversation(fiches, 's-tmux')).toBe('cse_13');
  });

  test('jumelle rangée seule : la fiche de poste reste l’entrée', () => {
    const fiches = [poste('s-tmux', 'conv-14', 'tmux'), rc('cse_14', 'conv-14', { archivee: true })];
    expect(visibles(fiches)).toEqual(['s-tmux']);
  });

  test('conversation rangée d’un bloc (poste et jumelle archivées) : rien à masquer, rien de visible', () => {
    const fiches = [
      poste('s-tmux', 'conv-15', 'tmux', { archivee: true }),
      rc('cse_15', 'conv-15', { archivee: true }),
    ];
    expect(planDoublons(fiches).masquees.size).toBe(0);
    expect(visibles(fiches.filter((f) => !f.archivee))).toEqual([]);
  });

  test('conversation rangée puis rouverte : une entrée, la fiche de poste', () => {
    const fiches = [poste('s-tmux', 'conv-16', 'tmux'), rc('cse_16', 'conv-16')];
    expect(visibles(fiches)).toEqual(['s-tmux']);
  });

  test('synchro de favoris ou de catégorie reçue : sans effet sur le masquage', () => {
    const fiches = [poste('s-tmux', 'conv-17', 'tmux'), rc('cse_17', 'conv-17')];
    expect(visibles(fiches)).toEqual(['s-tmux']);
    expect(cibleConversation(fiches, 'cse_17')).toBe('s-tmux');
  });

  test('session déplacée d’une catégorie à une autre : la conversation reste une seule entrée', () => {
    const fiches = [poste('s-tmux', 'conv-18', 'tmux'), rc('cse_18', 'conv-18', { majLe: T(9) })];
    expect(visibles(fiches)).toEqual(['s-tmux']);
    expect(membresConversation(fiches, 'cse_18').sort()).toEqual(['cse_18', 's-tmux']);
  });
});

const journal = pino({ enabled: false });
const ids = (sessions: readonly ResumeSession[]): string[] => sessions.map((s) => s.id).sort();

function requete(id: string, action: string): Request & { params: { id: string; action: string } } {
  return Object.assign(new Request(`http://relais.test/api/sessions/${id}/${action}`, { method: 'POST' }), {
    params: { id, action },
  });
}

// Postes qui acceptent les commandes (fermeture à l'archivage) ; les commandes reçues sont relevées.
function postesAccepteurs(commandes: unknown[]): Postes {
  return {
    commander: (_machine: string, commande: unknown) => {
      commandes.push(commande);
      return Promise.resolve({ ok: true });
    },
    decouvertes: () => [],
  } as unknown as Postes;
}

// Monde Lanterne : fiche sdk vivante, ancienne jumelle déconnectée, jumelle neuve vivante.
function mondeSdk(): { registre: Registre; diffusion: Diffusion; messages: MessageClient[] } {
  const registre = new Registre(ouvrirBase(':memory:'));
  const diffusion = new Diffusion();
  const messages: MessageClient[] = [];
  diffusion.ecouter((m) => messages.push(m));
  registre.enregistrerSession(poste('s-sdk', 'conv-1', 'sdk', { majLe: T(10) }));
  registre.enregistrerSession(rc('cse_old', 'conv-1', { connectee: false, majLe: T(8) }));
  registre.enregistrerSession(rc('cse_new', 'conv-1', { majLe: T(11) }));
  registre.enregistrerSession(poste('s-autre', 'conv-2', 'sdk'));
  registre.enregistrerCategories([
    { id: 'a', nom: 'A', replie: false, sessions: ['cse_old'] },
    { id: 'b', nom: 'B', replie: false, sessions: ['s-sdk', 's-autre'] },
  ]);
  return { registre, diffusion, messages };
}

describe('conversation pilotée (Lanterne) : une entrée, comme pour Claude Desktop', () => {
  test('la fiche sdk et sa jumelle Remote Control ne forment qu’une entrée', () => {
    const { registre, diffusion } = mondeSdk();
    new Doublons(registre, diffusion, journal).reconcilier();
    expect(ids(registre.sessions(false))).toEqual(['s-autre', 's-sdk']);
  });

  test('épingler depuis la jumelle épingle la fiche sdk', async () => {
    const { registre, diffusion } = mondeSdk();
    const api = new ApiSessions(registre, postesAccepteurs([]), diffusion, new Set(), journal);
    await api.action(requete('cse_new', 'epingler'));
    expect(registre.session('s-sdk')?.epinglee).toBe(true);
    expect(registre.session('cse_new')?.epinglee).toBe(false);
  });

  test('non-lu posé sur la jumelle est reporté sur la fiche sdk', async () => {
    const { registre, diffusion } = mondeSdk();
    const api = new ApiSessions(registre, postesAccepteurs([]), diffusion, new Set(), journal);
    await api.action(requete('cse_new', 'marquer_non_lue'));
    expect(registre.session('s-sdk')?.nonLue).toBe(true);
    expect(registre.session('cse_new')?.nonLue).toBe(false);
  });

  test('archiver depuis la jumelle ferme la fiche sdk et range toute la conversation', async () => {
    const { registre, diffusion } = mondeSdk();
    const commandes: unknown[] = [];
    const api = new ApiSessions(registre, postesAccepteurs(commandes), diffusion, new Set(), journal);
    await api.action(requete('cse_new', 'archiver'));
    expect(commandes).toEqual([{ kind: 'fermer', sessionId: 's-sdk' }]);
    expect(registre.session('cse_old')?.archivee).toBe(true);
    expect(ids(registre.sessions(false))).toEqual(['s-autre']);
  });

  test('catégorie : l’entrée reste dans la catégorie de la fiche sdk, une seule fois', () => {
    const { registre, diffusion } = mondeSdk();
    new Doublons(registre, diffusion, journal).reconcilier();
    const cats = registre.categories();
    expect(cats.flatMap((c) => c.sessions).filter((id) => id === 's-sdk')).toHaveLength(1);
    expect(cats.find((c) => c.id === 'b')?.sessions).toEqual(['s-sdk', 's-autre']);
    expect(cats.find((c) => c.id === 'a')?.sessions).toEqual([]);
  });

  test('reprise (`--resume`) : l’ancienne fiche cède à la nouvelle, épinglée et non lue avec elle', () => {
    const { registre, diffusion } = mondeSdk();
    registre.enregistrerSession(poste('s-old', 'conv-1', 'sdk', { statut: 'fermee', majLe: T(7) }));
    registre.definirEpinglee('s-old', true);
    registre.definirNonLue('s-old', true);
    new Doublons(registre, diffusion, journal).reconcilier();
    expect(ids(registre.sessions(false))).toEqual(['s-autre', 's-sdk']);
    expect(registre.session('s-sdk')?.epinglee).toBe(true);
    expect(registre.session('s-sdk')?.nonLue).toBe(true);
    expect(registre.session('s-old')?.epinglee).toBe(false);
  });

  test('archivée depuis la jumelle, rouverte depuis la fiche sdk : une entrée', async () => {
    const { registre, diffusion } = mondeSdk();
    const commandes: unknown[] = [];
    const api = new ApiSessions(registre, postesAccepteurs(commandes), diffusion, new Set(), journal);
    await api.action(requete('cse_new', 'archiver'));
    await api.action(requete('s-sdk', 'desarchiver'));
    const brutes = registre.sessionsBrutes();
    expect(brutes.filter((s) => s.archivee).map((s) => s.id)).toEqual([]);
    expect(ids(registre.sessions(false))).toEqual(['s-autre', 's-sdk']);
  });

  test('copie du duo, la plus récente : jamais l’entrée principale, la fiche sdk du propriétaire reste', () => {
    const { registre, diffusion } = mondeSdk();
    registre.enregistrerSession(poste('s-duo', 'conv-1', 'sdk', { duo: true, machine: 'marc', majLe: T(12) }));
    new Doublons(registre, diffusion, journal).reconcilier();
    expect(ids(registre.sessions(false))).toEqual(['s-autre', 's-sdk']);
    expect(registre.session('s-duo')?.archivee).toBe(true);
  });

  test('copie du duo seule avec la jumelle du pair : la jumelle reste l’entrée', () => {
    const registre = new Registre(ouvrirBase(':memory:'));
    registre.enregistrerSession(poste('s-duo', 'conv-9', 'sdk', { duo: true, machine: 'marc' }));
    registre.enregistrerSession(rc('cse_9', 'conv-9'));
    new Doublons(registre, new Diffusion(), journal).reconcilier();
    expect(ids(registre.sessions(false))).toEqual(['cse_9']);
  });

  test('réparation au démarrage : un épinglage posé sur la jumelle passe à la fiche sdk', () => {
    const { registre, diffusion } = mondeSdk();
    registre.definirEpinglee('cse_new', true);
    new Doublons(registre, diffusion, journal).reconcilier();
    expect(registre.session('s-sdk')?.epinglee).toBe(true);
    expect(registre.session('cse_new')?.epinglee).toBe(false);
  });

  test('Remote Control coupé puis réactivé : pas de doublon, l’épinglage reste sur la fiche sdk', () => {
    const { registre, diffusion, messages } = mondeSdk();
    const service = new Doublons(registre, diffusion, journal);
    service.reconcilier();
    registre.definirEpinglee('s-sdk', true);
    registre.enregistrerSession(rc('cse_newest', 'conv-1', { majLe: T(13) }));
    service.reconcilier();
    expect(ids(registre.sessions(false))).toEqual(['s-autre', 's-sdk']);
    expect(registre.session('s-sdk')?.epinglee).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
  });
});
