import { describe, expect, test } from 'bun:test';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ApiConfiguration } from './api-configuration.ts';

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
  return { api: new ApiConfiguration(postes), recues };
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
  test('connecteurs relayés', async () => {
    const liste = [{ nom: 'exemple', cible: '/fictif', etat: 'connecte' }];
    const { api: a, recues } = api({ ok: true, donnees: liste });
    expect(await (await a.connecteurs(requete('tour', { methode: 'GET' }))).json()).toEqual(liste);
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
