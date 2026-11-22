// Responsabilité : tests de l'accord différé du mode duo — ouvrir une session chez le pair et passer la main rendent
// « en attente » tout de suite ; l'issue arrive ensuite en `duo_issue`. Sans accord à demander, réponse directe.
/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test';
import type { MessageClient } from '../../commun/api-clients.ts';
import { DROITS_PAR_DEFAUT, type Droits, type MessageLien } from '../../commun/duo.ts';
import { routesDuo } from './api-duo.ts';
import { Attentes } from './attentes.ts';
import { type Banc, attendre, deuxBancs, ficheOuverte, poster } from './banc-duo.ts';
import type { Engagement } from './contexte.ts';
import type { Resultat } from './resultat.ts';

const bancs: Banc[] = [];
afterEach(() => {
  for (const b of bancs.splice(0)) b.duo.arreter();
});

async function duo(delaiDemandeMs = 5_000): Promise<{ a: Banc; b: Banc }> {
  const { a, b } = await deuxBancs({ delaiDemandeMs });
  bancs.push(a, b);
  return { a, b };
}

const droits = (surcharge: Partial<Droits>): Droits => ({ ...DROITS_PAR_DEFAUT, ...surcharge });
const ouvertures = (x: Banc): Record<string, unknown>[] => x.commandes.filter((c) => c['kind'] === 'ouvrir');
type Issue = Extract<MessageClient, { type: 'duo_issue' }>;
const issues = (x: Banc): Issue[] =>
  x.recus.filter((m): m is Issue => m.type === 'duo_issue');

function enAttente(r: Resultat<Engagement>): string {
  if (!r.ok || r.valeur.etat !== 'en_attente') throw new Error(`pas en attente : ${JSON.stringify(r)}`);
  return r.valeur.demande;
}

const sessionProjet = (id: string, chemin: string): ReturnType<typeof ficheOuverte> => ({
  ...ficheOuverte(id, chemin, 'default'),
  projet: { machine: 'tour', chemin, nom: 'proj' },
});

describe('ouvrir une session chez le pair : accord différé', () => {
  test('en attente tout de suite, puis accord → duo_issue avec la session ouverte chez alice', async () => {
    const { a, b } = await duo();
    const r = await b.duo.ouvrirChezPair({ machine: 'tour', chemin: '/p1', message: 'salut' });
    const id = enAttente(r);
    expect(a.duo.listerDemandes()[0]?.id).toBe(id);
    a.duo.decider(id, true);
    await attendre(() => issues(b).length === 1);
    expect(issues(b)[0]).toMatchObject({ type: 'duo_issue', demande: id, accord: true, session: expect.any(String) });
    expect(ouvertures(a)).toHaveLength(1);
  });

  test('en attente, puis refus → duo_issue « refusé par alice », rien d’ouvert', async () => {
    const { a, b } = await duo();
    const id = enAttente(await b.duo.ouvrirChezPair({ machine: 'tour', chemin: '/p1', message: 'non' }));
    a.duo.decider(id, false);
    await attendre(() => issues(b).length === 1);
    expect(issues(b)[0]).toMatchObject({ demande: id, accord: false, raison: 'refusé par alice' });
    expect(ouvertures(a)).toEqual([]);
  });

  test('délai sans réponse côté propriétaire → duo_issue accord false, raison « sans réponse »', async () => {
    const { b } = await duo(100);
    const id = enAttente(await b.duo.ouvrirChezPair({ machine: 'tour', chemin: '/p1', message: 'seul' }));
    await attendre(() => issues(b).length === 1);
    expect(issues(b)[0]).toMatchObject({ demande: id, accord: false, raison: 'sans réponse' });
  });

  test('sans accord à demander (toujours, dossier autorisé) : réponse directe, aucun duo_issue', async () => {
    const { a, b } = await duo();
    a.duo.majDroits(droits({ ouvrirSession: 'toujours', dossiersOuverts: [{ machine: 'tour', chemin: '/p1' }] }));
    const r = await b.duo.ouvrirChezPair({ machine: 'tour', chemin: '/p1', message: 'direct' });
    expect(r).toMatchObject({ ok: true, valeur: { etat: 'fait', session: expect.any(String) } });
    expect(a.duo.listerDemandes()).toEqual([]);
    await new Promise((rendre) => setTimeout(rendre, 20));
    expect(issues(b)).toEqual([]);
  });

  test('refus direct (jamais) : réponse directe en erreur, aucun duo_issue', async () => {
    const { a, b } = await duo();
    a.duo.majDroits(droits({ ouvrirSession: 'jamais' }));
    const r = await b.duo.ouvrirChezPair({ machine: 'tour', chemin: '/p1', message: 'refuse' });
    expect(r).toMatchObject({ ok: false, statut: 409, raison: 'refusé par alice' });
    expect(issues(b)).toEqual([]);
  });

  test('les routes répondent 202 avec la demande, sans attendre le pair', async () => {
    const { a, b } = await duo();
    const table = routesDuo(b.duo, (g) => g);
    const corps = JSON.stringify({ machine: 'tour', chemin: '/p1', message: 'salut' });
    const reponse = await table['/api/duo/sessions'].POST(
      new Request('http://relais/api/duo/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: corps,
      }) as never,
    );
    expect(reponse.status).toBe(202);
    const lu = (await reponse.json()) as { demande: string; etat: string };
    expect(lu).toEqual({ demande: expect.any(String), etat: 'en_attente' });
    expect(a.duo.listerDemandes()[0]?.id).toBe(lu.demande);
    a.duo.decider(lu.demande, false);
  });
});

describe('passer la main : accord différé', () => {
  test('en attente, puis accord avec dossier → duo_issue, et la ligne « passée » au fil du donneur', async () => {
    const { a, b } = await duo();
    poster(b, { kind: 'session', session: sessionProjet('p1', '/pb/proj') });
    const id = enAttente(await b.duo.avances.passerLaMain('p1', 'à reprendre'));
    a.duo.decider(id, true, { machine: 'tour', chemin: '/pa/neuf' });
    await attendre(() => issues(b).length === 1);
    expect(issues(b)[0]).toMatchObject({ demande: id, accord: true, session: expect.any(String) });
    const fil = b.registre.derniersEvenements('p1', 50).map((e) => e.evt);
    expect(fil).toContainEqual({ type: 'duo_main', vers: 'alice' });
  });

  test('en attente, puis refus → duo_issue « refusé par alice », aucune ligne au fil', async () => {
    const { a, b } = await duo();
    poster(b, { kind: 'session', session: sessionProjet('p1', '/pb/proj') });
    const id = enAttente(await b.duo.avances.passerLaMain('p1', undefined));
    a.duo.decider(id, false);
    await attendre(() => issues(b).length === 1);
    expect(issues(b)[0]).toMatchObject({ demande: id, accord: false, raison: 'refusé par alice' });
    const fil = b.registre.derniersEvenements('p1', 50).map((e) => e.evt);
    expect(fil.some((e) => e.type === 'duo_main')).toBe(false);
  });
});

describe('suivi d’une requête sur le lien', () => {
  test('après une attente, sans réponse finale dans le délai : fin à null, après l’annonce', async () => {
    const attentes = new Attentes();
    const requete: MessageLien = { type: 'dossiers', ref: 'r1' };
    const annonces: string[] = [];
    const fins: (MessageLien | null)[] = [];
    attentes.suivre('r1', requete, () => true, 20, {
      attente: (demande) => annonces.push(demande),
      fin: (m) => fins.push(m),
    });
    attentes.recevoir('r1', { type: 'attente', ref: 'r1', demande: 'd1' });
    await attendre(() => fins.length === 1);
    expect(annonces).toEqual(['d1']);
    expect(fins).toEqual([null]);
  });
});
