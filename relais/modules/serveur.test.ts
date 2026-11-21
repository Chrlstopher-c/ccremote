// Responsabilité : tests côté relais de la partie serveur des modules (v1.2) — la route POST relaie la requête au
// poste de la machine du serveur et rend sa réponse ; serveur absent, en panne, sans serveur, module inconnu, corps
// trop gros ; la liste des modules porte l'état du serveur ; le poste qui signale un état le fait savoir aux clients.
// Postes et registre simulés, base en mémoire : aucune machine contactée.
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import type { ManifesteModule } from '../../commun/modules.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { type DonneesPoste, Postes, type ReponsePoste } from '../parc/postes.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { lireModules } from './api-modules.ts';
import { requeteServeurModule } from './api-serveur.ts';

const journal = pino({ enabled: false });
const EMPREINTE = 'a'.repeat(64);
const MANIFESTE: ManifesteModule = {
  id: 'carte',
  nom: 'Carte',
  version: '1.0.0',
  description: 'Test',
  icone: 'map',
  point: 'index.js',
  emplacements: ['panneau'],
  serveur: { point: 'serveur/index.ts' },
};

type Commande = Parameters<Postes['commander']>[1];

function montage(manifeste: ManifesteModule = MANIFESTE, machine = 'tour'): Registre {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  const module = { kind: 'module' as const, id: manifeste.id, manifeste, fichiers: [], empreinte: EMPREINTE };
  registre.modules.enregistrer(machine, module);
  return registre;
}

function postesAvec(
  reponse: (machine: string, c: Commande) => ReponsePoste,
  enLigne: (machine: string) => boolean = () => true,
): { postes: Pick<Postes, 'commander' | 'enLigne'>; appels: Array<{ machine: string; c: Commande }> } {
  const appels: Array<{ machine: string; c: Commande }> = [];
  const postes = {
    commander: async (machine: string, c: Commande) => {
      appels.push({ machine, c });
      return reponse(machine, c);
    },
    enLigne,
  };
  return { postes, appels };
}

function requete(corps: unknown): Request {
  return new Request('http://relais.test/api/modules/carte/serveur', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });
}

describe('requête relayée au serveur d’un module', () => {
  test('la requête part au poste de la machine du module, et sa réponse revient telle quelle', async () => {
    const { postes, appels } = postesAvec(() => ({
      ok: true,
      donnees: { status: 201, headers: { 'x-a': '1' }, body: 'bien reçu', encodage: 'texte' },
    }));
    const corps = { chemin: '/ping', method: 'POST', body: 'x' };
    const r = await requeteServeurModule(montage(), postes, 'carte', requete(corps));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 201, headers: { 'x-a': '1' }, body: 'bien reçu', encodage: 'texte' });
    expect(appels.map((a) => a.machine)).toEqual(['tour']);
    expect(appels[0]?.c).toMatchObject({ kind: 'module_requete', module: 'carte', requete: corps });
  });

  test('le serveur déclare sa machine : la requête va à cette machine', async () => {
    const declare = { ...MANIFESTE, serveur: { point: 'serveur/index.ts', machine: 'pi' } };
    const vide = { status: 200, headers: {}, body: '', encodage: 'texte' as const };
    const { postes, appels } = postesAvec(() => ({ ok: true, donnees: vide }));
    await requeteServeurModule(montage(declare), postes, 'carte', requete({ chemin: '/' }));
    expect(appels.map((a) => a.machine)).toEqual(['pi']);
  });

  test('serveur absent, en panne ou poste hors ligne : 503 avec la raison', async () => {
    const { postes } = postesAvec(() => ({ ok: false, erreur: 'tour est hors ligne' }));
    const r = await requeteServeurModule(montage(), postes, 'carte', requete({ chemin: '/' }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({
      status: 503,
      headers: {},
      body: '',
      encodage: 'texte',
      erreur: 'tour est hors ligne',
    });
  });

  test('module sans serveur : 503 ; module inconnu : 404', async () => {
    const sans: ManifesteModule = { ...MANIFESTE, serveur: undefined };
    const { postes } = postesAvec(() => ({ ok: true }));
    const sansServeur = await requeteServeurModule(montage(sans), postes, 'carte', requete({ chemin: '/' }));
    expect(sansServeur.status).toBe(503);
    const inconnu = await requeteServeurModule(montage(), postes, 'autre', requete({ chemin: '/' }));
    expect(inconnu.status).toBe(404);
  });

  test('un corps de plus de 4 Mo est refusé en 413, sans rien relayer', async () => {
    const { postes, appels } = postesAvec(() => ({ ok: true }));
    const gros = { chemin: '/', body: 'x'.repeat(5 * 1024 * 1024) };
    const r = await requeteServeurModule(montage(), postes, 'carte', requete(gros));
    expect(r.status).toBe(413);
    expect(appels).toEqual([]);
  });

  test('un corps invalide est refusé en 400', async () => {
    const { postes } = postesAvec(() => ({ ok: true }));
    const r = await requeteServeurModule(montage(), postes, 'carte', requete({ sans: 'chemin' }));
    expect(r.status).toBe(400);
  });
});

describe('état du serveur dans la liste des modules', () => {
  test('le serveur porte sa machine, son état et son erreur ; sans état signalé, il est arrêté', async () => {
    const registre = montage();
    const { postes } = postesAvec(() => ({ ok: true }));
    const avant = (await lireModules(registre, postes).json()) as Array<{ serveur: unknown }>;
    expect(avant[0]?.serveur).toEqual({ machine: 'tour', etat: 'arrete', erreur: null });
    registre.modules.serveurMaj('carte', { etat: 'panne', erreur: 'relances épuisées' });
    const apres = (await lireModules(registre, postes).json()) as Array<{ serveur: unknown }>;
    expect(apres[0]?.serveur).toEqual({ machine: 'tour', etat: 'panne', erreur: 'relances épuisées' });
  });

  test('un poste hors ligne n’a plus de serveur en marche', async () => {
    const registre = montage();
    registre.modules.serveurMaj('carte', { etat: 'pret', erreur: null });
    const { postes } = postesAvec(
      () => ({ ok: true }),
      () => false,
    );
    const liste = (await lireModules(registre, postes).json()) as Array<{ serveur: unknown }>;
    expect(liste[0]?.serveur).toEqual({ machine: 'tour', etat: 'arrete', erreur: 'tour est hors ligne' });
  });

  test('un module sans serveur a « serveur : null » ; un envoi d’une autre machine remet l’état à zéro', async () => {
    const registre = montage();
    registre.modules.serveurMaj('carte', { etat: 'pret', erreur: null });
    expect(registre.modules.serveurMaj('carte', { etat: 'pret', erreur: null })).toBe(false);
    const autre = { kind: 'module' as const, id: 'carte', manifeste: MANIFESTE, fichiers: [], empreinte: EMPREINTE };
    registre.modules.enregistrer('pi', autre);
    expect(registre.modules.obtenir('carte')?.serveur).toBeNull();
    const sans = montage({ ...MANIFESTE, id: 'meteo', serveur: undefined });
    const liste = (await lireModules(sans).json()) as Array<{ serveur: unknown }>;
    expect(liste[0]?.serveur).toBeNull();
  });
});

describe('le poste signale l’état de son serveur', () => {
  test('module_serveur met à jour l’état et prévient les clients', () => {
    const registre = montage();
    const diffusion = new Diffusion();
    const recus: MessageClient[] = [];
    const client = { send: (t: string) => recus.push(JSON.parse(t) as MessageClient) };
    diffusion.ajouter(client as unknown as ServerWebSocket<unknown>);
    const poste = { data: { machine: 'tour' } } as unknown as ServerWebSocket<DonneesPoste>;
    const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
    postes.recu(poste, JSON.stringify({ kind: 'module_serveur', id: 'carte', etat: 'pret' }));
    expect(registre.modules.obtenir('carte')?.serveur).toEqual({ etat: 'pret', erreur: null });
    expect(recus).toEqual([{ type: 'modules_modifies' }]);
  });
});
