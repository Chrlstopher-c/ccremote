// Responsabilité : tests du mode duo de bout en bout — deux relais en mémoire dans le même processus, reliés sur
// 127.0.0.1 par leur lien WebSocket réel (appairage, partage, présence, coupure, révocation).
/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import { DUREE_CODE_MS, type EtatDuo, type CorpsPartage } from '../../commun/duo.ts';
import type { MessageClient } from '../../commun/api-clients.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ApiSessions } from '../clients/api-sessions.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { type DonneesPoste, Postes } from '../parc/postes.ts';
import { Duo, type Resultat } from './duo.ts';
import { routesDuo } from './api-duo.ts';
import { PaireStockee } from './paire-stockee.ts';

const journal = pino({ enabled: false });
const MAJ = '2026-11-21T10:00:00.000Z';

interface Relais {
  readonly nom: string;
  readonly registre: Registre;
  readonly diffusion: Diffusion;
  readonly postes: Postes;
  readonly duo: Duo;
  readonly dossier: string;
  readonly poste: ServerWebSocket<DonneesPoste>;
  readonly recus: MessageClient[];
}

const relais: Relais[] = [];
const pontSansSessions = (): Promise<Response> =>
  Promise.resolve(Response.json({ erreur: 'sans sessions' }, { status: 409 }));
const pontSimule = {
  ouvrir: pontSansSessions,
  envoyer: pontSansSessions,
  interrompre: pontSansSessions,
  tracer: pontSansSessions,
};
let maintenant = Date.parse(MAJ);
const horloge = { lire: (): number => maintenant, avancer: (ms: number): void => void (maintenant += ms) };

function creerRelais(utilisateur: string): Relais {
  const base = ouvrirBase(':memory:');
  const registre = new Registre(base, journal);
  const diffusion = new Diffusion();
  const recus: MessageClient[] = [];
  diffusion.ecouter((m) => recus.push(m));
  const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
  const dossier = mkdtempSync(join(tmpdir(), `duo-${utilisateur}-`));
  const duo = new Duo({
    registre,
    diffusion,
    base,
    utilisateur,
    dossierSecrets: dossier,
    ecoute: '127.0.0.1',
    port: 0,
    journal,
    maintenant: horloge.lire,
    delaiReconnexionMs: 20,
    postes,
    sessions: pontSimule,
  });
  duo.demarrer();
  const poste = {
    data: { machine: 'tour' },
    send: () => undefined,
    close: () => undefined,
  } as unknown as ServerWebSocket<DonneesPoste>;
  postes.ouvert(poste);
  const r: Relais = { nom: utilisateur, registre, diffusion, postes, duo, dossier, poste, recus };
  relais.push(r);
  return r;
}

afterEach(() => {
  for (const r of relais.splice(0)) {
    r.duo.arreter();
    rmSync(r.dossier, { recursive: true, force: true });
  }
});

async function attendre(condition: () => boolean, ms = 3000): Promise<void> {
  const fin = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > fin) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function ok<T>(r: Resultat<T>): T {
  if (!r.ok) throw new Error(`refus inattendu : ${r.raison}`);
  return r.valeur;
}

function adresse(r: Relais): string {
  return `127.0.0.1:${r.duo.portEcoute}`;
}

async function deuxRelais(): Promise<{ a: Relais; b: Relais }> {
  const a = creerRelais('alice');
  const b = creerRelais('bob');
  const code = ok(a.duo.codeAppairage());
  ok(await b.duo.rejoindre(`127.0.0.1:${a.duo.portEcoute}`, code.code));
  await attendre(() => a.duo.etat().etat === 'connecte' && b.duo.etat().etat === 'connecte');
  return { a, b };
}

function fiche(id: string, chemin: string): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin, nom: 'p' },
    cwd: chemin,
    titre: `Titre ${id}`,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: id,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
  };
}

function envoyerPoste(r: Relais, message: object): void {
  r.postes.recu(r.poste, JSON.stringify(message));
}

function texte(r: Relais, id: string): string[] {
  return r.registre.derniersEvenements(id, 50).flatMap((e) => (e.evt.type === 'message' ? [e.evt.texte] : []));
}

function partager(r: Relais, corps: CorpsPartage): EtatDuo {
  return ok(r.duo.partager(corps));
}

describe('mode duo — appairage', () => {
  test('code faux ou expiré refusé, appairage valide ouvre le lien des deux côtés', async () => {
    const a = creerRelais('alice');
    const b = creerRelais('bob');
    const faux = await b.duo.rejoindre(adresse(a), 'ZZZZZZZZ');
    expect(faux.ok).toBe(false);
    const expire = ok(a.duo.codeAppairage());
    maintenant += DUREE_CODE_MS + 1;
    const refuse = await b.duo.rejoindre(adresse(a), expire.code);
    expect(refuse.ok).toBe(false);
    if (!refuse.ok) expect(refuse.raison).toContain('expiré');
    const code = ok(a.duo.codeAppairage());
    ok(await b.duo.rejoindre(adresse(a), code.code));
    await attendre(() => b.duo.etat().etat === 'connecte' && a.duo.etat().etat === 'connecte');
    expect(b.duo.etat().pair).toEqual({ utilisateur: 'alice', nom: 'alice', adresse: adresse(a) });
    expect(a.duo.etat().pair).toEqual({ utilisateur: 'bob', nom: 'bob', adresse: null });
  });

  test('un second appairage est refusé tant que la paire existe', async () => {
    const { a, b } = await deuxRelais();
    expect(a.duo.codeAppairage().ok).toBe(false);
    const r = await b.duo.rejoindre(adresse(a), 'AAAAAAAA');
    expect(r.ok).toBe(false);
  });

  test('lien refusé avec une mauvaise clé', async () => {
    const { a, b } = await deuxRelais();
    const store = new PaireStockee(b.dossier, journal);
    const paire = store.lire();
    if (!paire) throw new Error('paire absente');
    store.ecrire({ ...paire, cle: 'ab'.repeat(32) });
    b.duo.couperLien();
    await attendre(() => b.duo.etat().etat === 'refuse');
    expect(a.duo.etat().etat).toBe('hors_ligne');
  });
});

describe('mode duo — partage et synchro', () => {
  test('session partagée visible chez le pair sous le nom de sa machine, événements en direct', async () => {
    // une session non partagée ne traverse jamais le lien
    const { a, b } = await deuxRelais();
    envoyerPoste(a, { kind: 'session', session: fiche('s1', '/p1') });
    envoyerPoste(a, { kind: 'session', session: fiche('s2', '/p2') });
    partager(a, { cible: 's2', genre: 'session', niveau: 'lecture' });
    await attendre(() => b.registre.session('s2') !== null);
    const vue = b.registre.session('s2');
    expect(vue?.machine).toBe('alice');
    expect(vue?.duo).toEqual({ pair: 'alice', nom: 'alice', niveau: 'lecture' });
    envoyerPoste(a, { kind: 'evenement', sessionId: 's2', ts: MAJ, evt: { type: 'message', texte: 'bonjour' } });
    await attendre(() => texte(b, 's2').includes('bonjour'));
    envoyerPoste(a, { kind: 'evenement', sessionId: 's1', ts: MAJ, evt: { type: 'message', texte: 'secret' } });
    await attendre(() => texte(b, 's2').includes('bonjour'));
    expect(b.registre.session('s1')).toBeNull();
    expect(texte(b, 's1')).toEqual([]);
    expect(b.recus.some((m) => m.type === 'evenement' && m.evenement.sessionId === 's2')).toBe(true);
  });

  test('partage par projet', async () => {
    const { a, b } = await deuxRelais();
    envoyerPoste(a, { kind: 'session', session: fiche('s1', '/p1') });
    partager(a, { cible: 'tour:/p1', genre: 'projet', niveau: 'ecriture' });
    await attendre(() => b.registre.session('s1') !== null);
    expect(b.registre.session('s1')?.duo).toEqual({ pair: 'alice', nom: 'alice', niveau: 'ecriture' });
  });

  test('retrait du partage et révocation font disparaître les sessions chez le pair', async () => {
    const { a, b } = await deuxRelais();
    envoyerPoste(a, { kind: 'session', session: fiche('s2', '/p2') });
    partager(a, { cible: 's2', genre: 'session', niveau: 'lecture' });
    await attendre(() => b.registre.session('s2') !== null);
    ok(a.duo.retirerPartage('s2'));
    await attendre(() => b.registre.session('s2') === null);
    partager(a, { cible: 's2', genre: 'session', niveau: 'lecture' });
    await attendre(() => b.registre.session('s2') !== null);
    a.duo.revoquer();
    await attendre(() => b.duo.etat().etat === 'absent');
    expect(b.registre.session('s2')).toBeNull();
    expect(a.duo.etat().etat).toBe('absent');
  });

  test('reconnexion après coupure : le lien revient et la relecture comble le trou', async () => {
    const { a, b } = await deuxRelais();
    envoyerPoste(a, { kind: 'session', session: fiche('s1', '/p1') });
    partager(a, { cible: 's1', genre: 'session', niveau: 'lecture' });
    await attendre(() => b.registre.session('s1') !== null);
    b.duo.couperLien();
    envoyerPoste(a, {
      kind: 'evenement',
      sessionId: 's1',
      ts: MAJ,
      evt: { type: 'message', texte: 'pendant la coupure' },
    });
    await attendre(() => b.duo.etat().etat === 'connecte');
    await attendre(() => texte(b, 's1').includes('pendant la coupure'));
  });

  test('présence du pair diffusée aux clients du propriétaire', async () => {
    const { a, b } = await deuxRelais();
    envoyerPoste(a, { kind: 'session', session: fiche('s2', '/p2') });
    partager(a, { cible: 's2', genre: 'session', niveau: 'lecture' });
    await attendre(() => b.registre.session('s2') !== null);
    expect(ok(b.duo.signalerPresence('s2', true))).toBeNull();
    await attendre(() => a.recus.some((m) => m.type === 'duo_presence' && m.present));
    expect(a.recus).toContainEqual({ type: 'duo_presence', session: 's2', present: true });
    expect(a.duo.etat().presences).toEqual(['s2']);
  });

  test('une commande locale visant une session du pair est refusée proprement', async () => {
    const { a, b } = await deuxRelais();
    envoyerPoste(a, { kind: 'session', session: fiche('s2', '/p2') });
    partager(a, { cible: 's2', genre: 'session', niveau: 'ecriture' });
    await attendre(() => b.registre.session('s2') !== null);
    const api = new ApiSessions(b.registre, b.postes, b.diffusion, new Set(), journal);
    const requete = Object.assign(
      new Request('http://relais/api/sessions/s2/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texte: 'salut' }),
      }),
      { params: { id: 's2' } },
    );
    const reponse = await api.envoyer(requete);
    expect(reponse.status).toBe(409);
    expect(((await reponse.json()) as { erreur: string }).erreur).toContain('pair');
  });
});

describe('mode duo — routes et identité', () => {
  test('routes : code, état, partage et présence', async () => {
    const a = creerRelais('alice');
    const table = routesDuo(a.duo, (g) => g);
    const code = await table['/api/duo/code'].POST(
      new Request('http://relais/api/duo/code', { method: 'POST' }) as never,
    );
    const corps = (await code.json()) as { code: string; port: number };
    expect(corps.code).toHaveLength(8);
    expect(corps.port).toBe(a.duo.portEcoute);
    const etat = await table['/api/duo'].GET(new Request('http://relais/api/duo') as never);
    expect(((await etat.json()) as EtatDuo).etat).toBe('absent');
  });

  test('un message de Chris porte le nom de la machine qui l’envoie', () => {
    const a = creerRelais('alice');
    envoyerPoste(a, {
      kind: 'bonjour',
      version: 'test',
      description: 'tour',
      racines: [],
      projets: [],
      comptes: [],
      sessions: [],
      utilisateur: 'carol',
    });
    envoyerPoste(a, { kind: 'session', session: fiche('s1', '/p1') });
    envoyerPoste(a, { kind: 'evenement', sessionId: 's1', ts: MAJ, evt: { type: 'message', texte: 'coucou' } });
    const evt = a.registre.derniersEvenements('s1', 1)[0]?.evt;
    expect(evt).toMatchObject({ type: 'message', auteur: 'carol' });
  });
});
