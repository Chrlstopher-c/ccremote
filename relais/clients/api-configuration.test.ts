import { describe, expect, test } from 'bun:test';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import pino from 'pino';
import { ApiConfiguration } from './api-configuration.ts';

const silencieux = pino({ level: 'silent' });

const EMPREINTE = 'a'.repeat(64);

type Recue = { machine: string; commande: Record<string, unknown> };

function api(reponse: ReponsePoste, machines: string[] = ['tour']): { api: ApiConfiguration; recues: Recue[] } {
  const recues: Recue[] = [];
  const postes = {
    commander: (machine: string, commande: Record<string, unknown>) => {
      recues.push({ machine, commande });
      return Promise.resolve(reponse);
    },
    vues: () => machines.map((id) => ({ id })),
  } as unknown as Postes;
  return { api: new ApiConfiguration(postes, silencieux), recues };
}

function requete(
  id: string,
  opts: { corps?: unknown; methode?: string; url?: string; params?: Record<string, string> } = {},
): Request & { params: Record<string, string> } {
  const init: RequestInit = { method: opts.methode ?? 'POST' };
  if (opts.corps !== undefined) init.body = JSON.stringify(opts.corps);
  const req = new Request(opts.url ?? 'http://relais.test/api', init);
  return Object.assign(req, { params: { id, ...opts.params } });
}

describe('styles de la machine', () => {
  test('création relayée au poste ; réponse 201 avec le nom', async () => {
    const { api: a, recues } = api({ ok: true, donnees: { nom: 'Sobre' } });
    const r = await a.creerStyle(
      requete('tour', { corps: { nom: 'Sobre', description: 'Bref', instructions: 'Court.' } }),
    );
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ nom: 'Sobre' });
    expect(recues[0]?.commande).toEqual({
      kind: 'styles_creer',
      nom: 'Sobre',
      description: 'Bref',
      instructions: 'Court.',
    });
  });

  test('fichier déjà existant : 409 avec le message du poste', async () => {
    const { api: a } = api({ ok: false, erreur: 'un style porte déjà ce nom' });
    const r = await a.creerStyle(requete('tour', { corps: { nom: 'Sobre', description: '', instructions: 'x' } }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erreur: 'un style porte déjà ce nom' });
  });

  test('nom réservé ou corps invalide : 400, rien n’est envoyé au poste', async () => {
    const { api: a, recues } = api({ ok: true });
    const r = await a.creerStyle(requete('tour', { corps: { nom: '', description: '', instructions: 'x' } }));
    expect(r.status).toBe(400);
    expect(recues.length).toBe(0);
  });

  test('machine inconnue : 404', async () => {
    const { api: a, recues } = api({ ok: true }, []);
    const r = await a.creerStyle(requete('absente', { corps: { nom: 'x', description: '', instructions: 'y' } }));
    expect(r.status).toBe(404);
    expect(recues.length).toBe(0);
  });
});

describe('CLAUDE.md de la machine', () => {
  test('lecture relayée tel quel', async () => {
    const { api: a, recues } = api({
      ok: true,
      donnees: { chemin: '/h/.claude/CLAUDE.md', contenu: '', empreinte: EMPREINTE },
    });
    const r = await a.instructions(requete('tour', { methode: 'GET' }));
    expect(await r.json()).toEqual({ chemin: '/h/.claude/CLAUDE.md', contenu: '', empreinte: EMPREINTE });
    expect(recues[0]?.commande).toEqual({ kind: 'instructions_lire' });
  });

  test('écriture avec empreinte invalide : 400', async () => {
    const { api: a } = api({ ok: true });
    const r = await a.ecrireInstructions(
      requete('tour', { methode: 'PUT', corps: { contenu: 'x', empreinte_avant: 'pas-une-empreinte' } }),
    );
    expect(r.status).toBe(400);
  });

  test('conflit : 409 `conflit`, rien d’écrit', async () => {
    const { api: a } = api({ ok: false, erreur: 'conflit' });
    const r = await a.ecrireInstructions(
      requete('tour', { methode: 'PUT', corps: { contenu: 'x', empreinte_avant: EMPREINTE } }),
    );
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erreur: 'conflit' });
  });

  test('écriture acceptée : empreinte nouvelle rendue', async () => {
    const { api: a } = api({ ok: true, donnees: { empreinte: 'b'.repeat(64) } });
    const r = await a.ecrireInstructions(
      requete('tour', { methode: 'PUT', corps: { contenu: 'x', empreinte_avant: EMPREINTE } }),
    );
    expect(await r.json()).toEqual({ empreinte: 'b'.repeat(64) });
  });
});

describe('compétences', () => {
  test('contenu hors liste : 403', async () => {
    const { api: a } = api({ ok: false, erreur: 'interdit' });
    const url = 'http://relais.test/api/machines/tour/competences/contenu?chemin=/etc/passwd';
    const r = await a.contenuCompetence(requete('tour', { methode: 'GET', url }));
    expect(r.status).toBe(403);
  });

  test('chemin absent : 400 ; compétence listée : contenu rendu', async () => {
    const { api: a } = api({ ok: true, donnees: { contenu: 'Corps' } });
    expect((await a.contenuCompetence(requete('tour', { methode: 'GET', url: 'http://r/x' }))).status).toBe(400);
    const r = await a.contenuCompetence(
      requete('tour', { methode: 'GET', url: 'http://r/x?chemin=%2Fh%2Fskills%2Fx%2FSKILL.md' }),
    );
    expect(await r.json()).toEqual({ contenu: 'Corps' });
  });

  test('liste relayée', async () => {
    const { api: a, recues } = api({ ok: true, donnees: [] });
    expect(await (await a.competences(requete('tour', { methode: 'GET' }))).json()).toEqual([]);
    expect(recues[0]?.commande).toEqual({ kind: 'competences_lister' });
  });
});

describe('connecteurs et plug-ins', () => {
  test('connecteurs relayés, avec la fraîcheur de la liste', async () => {
    const liste = [{ nom: 'exemple', cible: '/fictif', etat: 'connecte' }];
    const { api: a, recues } = api({ ok: true, donnees: liste });
    const corps = (await (await a.connecteurs(requete('tour', { methode: 'GET' }))).json()) as {
      connecteurs: unknown;
      fraicheur: string;
    };
    expect(corps.connecteurs).toEqual(liste);
    expect(Number.isNaN(Date.parse(corps.fraicheur))).toBe(false);
    expect(recues[0]?.commande).toEqual({ kind: 'connecteurs_machine' });
  });

  test('activation d’un plug-in : identifiant validé avant le poste', async () => {
    const { api: a, recues } = api({ ok: true, donnees: { id: 'e@m', actif: true } });
    expect(
      (await a.activerPlugin(requete('tour', { corps: { actif: true }, params: { plugin: '--force' } }))).status,
    ).toBe(400);
    expect(recues.length).toBe(0);
    const r = await a.activerPlugin(requete('tour', { corps: { actif: true }, params: { plugin: 'e@m' } }));
    expect(r.status).toBe(200);
    expect(recues[0]?.commande).toEqual({ kind: 'plugin_activer', plugin: 'e@m', actif: true });
  });
});

describe('connecteurs de la machine : cache et écritures', () => {
  test('seconde lecture : liste gardée servie, relecture de fond (une seule lecture au premier appel)', async () => {
    const { api: a, recues } = api({ ok: true, donnees: [] });
    await a.connecteurs(requete('tour', { methode: 'GET' }));
    const corps = (await (await a.connecteurs(requete('tour', { methode: 'GET' }))).json()) as { fraicheur: string };
    expect(Number.isNaN(Date.parse(corps.fraicheur))).toBe(false);
    await new Promise((resoudre) => setTimeout(resoudre, 0));
    expect(recues.filter((r) => r.commande['kind'] === 'connecteurs_machine')).toHaveLength(2);
  });

  test('ajout : 201 avec le nom, commande relayée telle quelle, liste périmée ensuite', async () => {
    const { api: a, recues } = api({ ok: true, donnees: { nom: 'echo-test' } });
    const corps = { nom: 'echo-test', type: 'stdio', commande: '/usr/bin/true' };
    const r = await a.ajouterConnecteur(requete('tour', { corps }));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ nom: 'echo-test' });
    expect(recues[0]?.commande).toMatchObject({ kind: 'connecteur_ajouter', definition: { nom: 'echo-test' } });
  });

  test('définition invalide : 400, rien envoyé au poste', async () => {
    const { api: a, recues } = api({ ok: true });
    const r = await a.ajouterConnecteur(requete('tour', { corps: { nom: 'x', type: 'http', url: 'file:///x' } }));
    expect(r.status).toBe(400);
    expect(recues).toHaveLength(0);
  });

  test('lecture : masquée par défaut, révélée seulement avec reveler=1', async () => {
    const { api: a, recues } = api({ ok: true, donnees: { nom: 'web-test', type: 'http' } });
    const url = 'http://relais.test/api/machines/tour/connecteurs/web-test?reveler=1';
    await a.connecteur(requete('tour', { methode: 'GET', url, params: { nom: 'web-test' } }));
    expect(recues[0]?.commande).toEqual({ kind: 'connecteur_lire', nom: 'web-test', reveler: true });
    const sans = 'http://relais.test/api/machines/tour/connecteurs/web-test';
    await a.connecteur(requete('tour', { methode: 'GET', url: sans, params: { nom: 'web-test' } }));
    expect(recues[1]?.commande).toEqual({ kind: 'connecteur_lire', nom: 'web-test', reveler: false });
  });

  test('nom invalide dans l’URL : 400', async () => {
    const { api: a, recues } = api({ ok: true });
    const r = await a.retirerConnecteur(requete('tour', { methode: 'DELETE', params: { nom: '-x' } }));
    expect(r.status).toBe(400);
    expect(recues).toHaveLength(0);
  });

  test('valeur masquée à l’ajout : 400, rien envoyé au poste', async () => {
    const { api: a, recues } = api({ ok: true });
    const corps = { nom: 'x', type: 'http', url: 'https://exemple.invalide/mcp', entetes: { A: '••••••' } };
    expect((await a.ajouterConnecteur(requete('tour', { corps }))).status).toBe(400);
    expect(recues).toHaveLength(0);
  });

  test('retrait refusé par le poste : 409 avec le message', async () => {
    const { api: a } = api({ ok: false, erreur: 'No MCP server named "x" in user scope' });
    const r = await a.retirerConnecteur(requete('tour', { methode: 'DELETE', params: { nom: 'x' } }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erreur: 'No MCP server named "x" in user scope' });
  });
});
