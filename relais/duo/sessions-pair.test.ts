// Responsabilité : tests de l'étape 2 « session sur le compte de l'autre » (droits jamais / demander / toujours,
// dossiers autorisés, partage en écriture de la session ouverte), dossiers offerts, usage partagé et journal des actions.
/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test';
import { DROITS_PAR_DEFAUT, type DossierOuvert, type Droits } from '../../commun/duo.ts';
import { type Banc, attendre, deuxBancs } from './banc-duo.ts';

const bancs: Banc[] = [];
afterEach(() => {
  for (const b of bancs.splice(0)) b.duo.arreter();
});

async function duo(): Promise<{ a: Banc; b: Banc }> {
  const { a, b } = await deuxBancs({ delaiDemandeMs: 5_000 });
  bancs.push(a, b);
  return { a, b };
}

function droits(surcharge: Partial<Droits>): Droits {
  return { ...DROITS_PAR_DEFAUT, ...surcharge };
}

const MAJ = '2026-11-21T10:00:00.000Z';
const dossier = (chemin: string): DossierOuvert => ({ machine: 'tour', chemin });
const ouvertures = (a: Banc): Record<string, unknown>[] => a.commandes.filter((c) => c['kind'] === 'ouvrir');

describe('session sur le compte de l’autre', () => {
  test('jamais : refusée, rien n’est ouvert', async () => {
    const { a, b } = await duo();
    a.duo.majDroits(droits({ ouvrirSession: 'jamais' }));
    const r = await b.duo.ouvrirChezPair({ machine: 'tour', chemin: '/p1', message: 'salut' });
    expect(r).toMatchObject({ ok: false, raison: 'refusé par alice' });
    expect(ouvertures(a)).toEqual([]);
    expect(a.duo.journalDuo()[0]).toMatchObject({ qui: 'bob', action: 'ouvrir_session', cible: 'tour:/p1' });
  });

  test('demander (défaut) : demande, accord → ouverte chez alice, partagée en écriture avec bob', async () => {
    const { a, b } = await duo();
    const attente = b.duo.ouvrirChezPair({ machine: 'tour', chemin: '/p1', message: 'salut' });
    await attendre(() => a.duo.listerDemandes().length === 1);
    expect(a.duo.listerDemandes()[0]).toMatchObject({ genre: 'ouvrir_session', de: 'bob', detail: 'tour · /p1' });
    a.duo.decider(a.duo.listerDemandes()[0]?.id ?? '', true);
    const r = await attente;
    expect(r.ok).toBe(true);
    const id = r.ok ? (r.valeur ?? '') : '';
    expect(ouvertures(a)[0]).toMatchObject({ demande: { mode: 'default', autonomie: false, message: 'salut' } });
    expect(a.duo.etat().partages).toContainEqual(
      expect.objectContaining({ cible: id, genre: 'session', niveau: 'ecriture' }),
    );
    await attendre(() => b.registre.session(id)?.duo?.niveau === 'ecriture');
    expect(b.registre.session(id)?.duo).toMatchObject({ pair: 'alice', niveau: 'ecriture' });
  });

  test('demander : refus → « refusé par alice », rien d’ouvert', async () => {
    const { a, b } = await duo();
    const attente = b.duo.ouvrirChezPair({ machine: 'tour', chemin: '/p1', message: 'non' });
    await attendre(() => a.duo.listerDemandes().length === 1);
    a.duo.decider(a.duo.listerDemandes()[0]?.id ?? '', false);
    expect(await attente).toMatchObject({ ok: false, raison: 'refusé par alice' });
    expect(ouvertures(a)).toEqual([]);
  });

  test('toujours + dossier autorisé (et son sous-dossier) : ouverte sans demande', async () => {
    const { a, b } = await duo();
    a.duo.majDroits(droits({ ouvrirSession: 'toujours', dossiersOuverts: [dossier('/p1')] }));
    const r = await b.duo.ouvrirChezPair({ machine: 'tour', chemin: '/p1/sous', message: 'direct' });
    expect(r.ok).toBe(true);
    expect(a.duo.listerDemandes()).toEqual([]);
    expect(ouvertures(a)).toHaveLength(1);
  });

  test('toujours + dossier hors liste : demande', async () => {
    const { a, b } = await duo();
    a.duo.majDroits(droits({ ouvrirSession: 'toujours', dossiersOuverts: [dossier('/p1')] }));
    const attente = b.duo.ouvrirChezPair({ machine: 'tour', chemin: '/autre', message: 'ailleurs' });
    await attendre(() => a.duo.listerDemandes().length === 1);
    a.duo.decider(a.duo.listerDemandes()[0]?.id ?? '', false);
    expect(await attente).toMatchObject({ ok: false, raison: 'refusé par alice' });
  });

  test('nom de machine vu du pair : « Cet ordinateur » devient « Ordinateur de <nom> »', async () => {
    const { a, b } = await duo();
    const base = { racines: [], projets: [], comptes: [], version: 'test', derniereVue: MAJ };
    a.registre.enregistrerMachine({ id: 'tour', description: 'Cet ordinateur', ...base });
    a.registre.enregistrerMachine({ id: 'portable', description: 'Portable', ...base });
    a.duo.majDroits(droits({ dossiersOuverts: [dossier('/p1'), { machine: 'portable', chemin: '/p2' }] }));
    expect(await b.duo.dossiersDuPair()).toEqual({
      ok: true,
      valeur: [
        { machine: 'tour', chemin: '/p1', nomMachine: 'Ordinateur de alice' },
        { machine: 'portable', chemin: '/p2', nomMachine: 'Portable' },
      ],
    });
  });

  test('dossiers offerts : seulement ceux que alice a ouverts', async () => {
    const { a, b } = await duo();
    a.duo.majDroits(droits({ dossiersOuverts: [dossier('/p1')] }));
    expect(await b.duo.dossiersDuPair()).toEqual({
      ok: true,
      valeur: [{ machine: 'tour', chemin: '/p1', nomMachine: 'tour' }],
    });
  });
});

describe('usage partagé', () => {
  test('sans permission : null ; avec permission : le compte d’alice, sous son nom', async () => {
    const { a, b } = await duo();
    a.registre.enregistrerMachine({
      id: 'tour',
      description: 'Tour',
      racines: [],
      projets: [],
      comptes: ['defaut'],
      version: 'test',
      derniereVue: '2026-11-21T10:00:00.000Z',
    });
    a.registre.majComptes('tour', [
      {
        id: 'defaut',
        defaut: true,
        connecte: true,
        email: 'alice@example.com',
        organisation: null,
        abonnement: 'max',
        session: { libelle: 'Session', pourcent: 42, reinitialiseLe: null },
        semaine: { libelle: 'Semaine', pourcent: 70, reinitialiseLe: null },
        autres: [],
        probleme: null,
        releveLe: '2026-11-21T10:00:00.000Z',
        connexion: null,
        distant: false,
        cle: 'alice@example.com',
        usageLe: null,
        prochainReleve: null,
      },
    ]);
    expect(await b.duo.usageDuPair()).toEqual({ ok: true, valeur: null });
    a.duo.majDroits(droits({ usagePartage: true }));
    const r = await b.duo.usageDuPair();
    expect(r).toMatchObject({
      ok: true,
      valeur: {
        compte: 'alice@example.com',
        utilisateur: 'alice',
        limites: [
          { genre: 'session', fenetre: { pourcent: 42 } },
          { genre: 'semaine', fenetre: { pourcent: 70 } },
        ],
      },
    });
  });
});
