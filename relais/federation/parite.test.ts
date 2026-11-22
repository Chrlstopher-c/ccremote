// Parité d'une session distante avec une session locale : texte en cours d'écriture en direct, routes de fichiers,
// git, artefacts et dossiers relayés, terminal, retrait immédiat d'une machine révoquée. Deux nœuds réels sur un
// aiguilleur réel (127.0.0.1). Données de test seulement.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { MessageClient } from '../../commun/api-clients.ts';
import type { ClientTerminal, DonneesTerminal } from '../appareils/terminaux.ts';
import { attendre, ficheDe } from './banc-federation.ts';
import {
  appairer,
  arreterBanc,
  demarrerBanc,
  ecouter,
  idDe,
  nouveau,
  requete,
  SESSION_A,
  sessionVue,
} from './parite-banc.ts';
import { type DonneesTerminalFedere, type TerminauxLocaux } from './terminal-federe.ts';

const TEXTE_CONFIDENTIEL = 'phrase confidentielle en cours d’écriture';

beforeEach(() => demarrerBanc());
afterEach(() => arreterBanc());

function textesFlux(recus: MessageClient[]): string {
  return recus.map((m) => (m.type === 'flux' ? m.delta : '')).join('');
}

describe('texte en cours d’écriture', () => {
  test('les deltas d’une session suivie arrivent en direct, regroupés ; rien sans abonnement', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const idA = await idDe(a);
    const recus = ecouter(b);
    a.diffusion.diffuser({ type: 'flux', sessionId: SESSION_A, bloc: 'b1', delta: 'avant ' });
    await new Promise((r) => setTimeout(r, 150));
    expect(recus.some((m) => m.type === 'flux')).toBe(false);
    await b.federation.distantes.fil(idA, SESSION_A);
    a.diffusion.diffuser({ type: 'flux', sessionId: SESSION_A, bloc: 'b1', delta: TEXTE_CONFIDENTIEL.slice(0, 10) });
    a.diffusion.diffuser({ type: 'flux', sessionId: SESSION_A, bloc: 'b1', delta: TEXTE_CONFIDENTIEL.slice(10) });
    await attendre(() => textesFlux(recus) === TEXTE_CONFIDENTIEL);
    const flux = recus.filter((m) => m.type === 'flux');
    expect(flux.every((m) => m.type === 'flux' && m.sessionId === SESSION_A)).toBe(true);
    expect(flux.length).toBeLessThanOrEqual(2);
    expect(b.charges.join('')).not.toContain(TEXTE_CONFIDENTIEL);
    expect(a.charges.join('')).not.toContain(TEXTE_CONFIDENTIEL);
  });
});

describe('gestes relayés : fichiers, git, artefacts, dossiers', () => {
  test('une route de la liste fermée est relayée avec son chemin, sa requête et son corps', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const lus = await b.federation.distantes.intercepter(requete(`/api/sessions/${SESSION_A}/git/diff?chemin=a.md`));
    expect(lus?.status).toBe(200);
    const ecrit = await b.federation.distantes.intercepter(
      requete(`/api/sessions/${SESSION_A}/artefacts/art-1/renommer`, 'POST', '{"nom":"neuf"}'),
    );
    expect(ecrit?.status).toBe(200);
    expect(a.appels.gestes.map((g) => [g.geste, g.methode, g.session, g.requete ?? null, g.corps ?? null])).toEqual([
      ['git/diff', 'GET', SESSION_A, 'chemin=a.md', null],
      ['artefacts/art-1/renommer', 'POST', SESSION_A, null, '{"nom":"neuf"}'],
    ]);
  });

  test('une route hors liste reste refusée sur une session d’un pair ; une session locale reste locale', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const supprimer = requete(`/api/sessions/${SESSION_A}/supprimer`, 'POST', '{}');
    const refusee = await b.federation.distantes.intercepter(supprimer);
    expect(refusee?.status).toBe(409);
    expect(await b.federation.distantes.intercepter(requete('/api/sessions/session-locale/git/diff'))).toBeNull();
    expect(a.appels.gestes).toEqual([]);
  });

  test('dossiers d’une machine d’un pair relayés à ce pair ; route de machine hors liste refusée', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    await sessionVue(a, b);
    await attendre(() => b.federation.distantes.membreDe(SESSION_A) !== null);
    const dossiers = await b.federation.distantes.intercepter(requete('/api/machines/tour/dossiers?chemin=%2Fprojets'));
    expect(dossiers?.status).toBe(200);
    expect(a.appels.gestes.at(-1)).toMatchObject({ geste: 'dossiers', machine: 'tour', requete: 'chemin=%2Fprojets' });
    const refusee = await b.federation.distantes.intercepter(requete('/api/machines/tour/comptes', 'POST', '{}'));
    expect(refusee?.status).toBe(409);
  });
});

describe('artefacts des pairs', () => {
  test('la liste du pair s’ajoute à la nôtre ; le pair la lit « local=1 » sans relayer', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const pairs = await b.federation.distantes.artefactsDesPairs();
    expect(pairs).toEqual([{ id: 'art-local=1', sessionId: 'session-a' }]);
    expect(a.appels.gestes.at(-1)).toMatchObject({ geste: 'artefacts', requete: 'local=1' });
  });
});

describe('terminal d’une session distante', () => {
  test('la sortie du PTY distant arrive à l’appli, la frappe repart, la fermeture ferme le PTY', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const ouverts: ClientTerminal<DonneesTerminal>[] = [];
    const fermes: string[] = [];
    a.federation.terminaux.brancher(terminalEcho(ouverts, fermes));
    const sortie: string[] = [];
    const terminal = '6f0e2d5a-1c3b-4e5f-8a9b-0c1d2e3f4a5b';
    const donnees = { type: 'terminal-federe' as const, terminal, membre: await idDe(a), session: SESSION_A };
    const ws = fauxWs({ ...donnees, colonnes: 80, lignes: 24 }, sortie);
    void b.federation.terminaux.ouvrir(ws);
    await attendre(() => sortie.join('') === 'invite$ ');
    expect(ouverts[0]?.data).toMatchObject({
      terminal,
      machine: 'tour',
      cible: { type: 'shell', dossier: `/projets/${SESSION_A}` },
    });
    b.federation.terminaux.recu(ws, Buffer.from('ls\n'));
    await attendre(() => sortie.join('') === 'invite$ ls\n');
    b.federation.terminaux.recu(ws, '{"type":"taille","colonnes":100,"lignes":30}');
    await attendre(() => sortie.join('').includes('taille:{"type":"taille","colonnes":100,"lignes":30}'));
    b.federation.terminaux.ferme(ws);
    await attendre(() => fermes.includes(terminal));
  });

  test('session inconnue du pair : l’appli reçoit l’erreur et le WebSocket se ferme', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const idA = await idDe(a);
    const sortie: string[] = [];
    let ferme = 0;
    const donnees = { type: 'terminal-federe' as const, terminal: 'abc-1', membre: idA, session: 'absente' };
    const ws = fauxWs({ ...donnees, colonnes: 80, lignes: 24 }, sortie);
    ws.close = () => (ferme += 1);
    await b.federation.terminaux.ouvrir(ws);
    expect(sortie.join('')).toContain('"type":"erreur"');
    expect(ferme).toBe(1);
  });
});

/** Un PTY d'essai : affiche une invite, fait écho de la saisie, rend la taille annoncée en texte. */
function terminalEcho(ouverts: ClientTerminal<DonneesTerminal>[], fermes: string[]): TerminauxLocaux {
  return {
    ouvert: async (ws) => {
      ouverts.push(ws);
      ws.send(Buffer.from('invite$ '));
      return true;
    },
    recu: (ws, m) => ws.send(Buffer.from(typeof m === 'string' ? `taille:${m}` : m)),
    ferme: (ws) => fermes.push(ws.data.terminal),
  };
}

function fauxWs(data: DonneesTerminalFedere, sortie: string[]): ClientTerminal<DonneesTerminalFedere> {
  return {
    data,
    send: (donnees) => {
      sortie.push(typeof donnees === 'string' ? donnees : Buffer.from(donnees).toString());
      return 0;
    },
    close: () => undefined,
  };
}

describe('révocation : une machine révoquée disparaît aussitôt', () => {
  test('côté révoquant comme côté révoqué : machine et sessions sortent de la vue aussitôt', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    const { idA } = await appairer(a, b);
    a.registre.enregistrerSession(ficheDe(SESSION_A, 'tour', 'Titre A'));
    a.diffusion.diffuser({ type: 'session', session: ficheDe(SESSION_A, 'tour', 'Titre A') });
    await attendre(() => b.federation.distantes.sessions().length === 1);
    const recusB = ecouter(b);
    const recusA = ecouter(a);
    expect(b.federation.revoquer(idA).ok).toBe(true);
    await attendre(() => recusB.some((m) => m.type === 'machine_retiree' && m.id === 'tour'));
    await attendre(() => recusA.some((m) => m.type === 'machine_retiree' && m.id === 'portable'));
    expect(recusB).toContainEqual({ type: 'supprimee', id: SESSION_A });
    expect(b.federation.distantes.sessions()).toEqual([]);
  });
});
