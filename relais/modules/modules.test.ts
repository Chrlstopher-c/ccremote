// Responsabilité : tests du relais pour les modules — réception des messages du poste, diffusion des changements,
// liste (GET /api/modules) et service des fichiers (GET /api/modules/<id>/<chemin>). Relais en mémoire.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { type DonneesPoste, Postes } from '../parc/postes.ts';
import { lireModules, servirFichierModule } from './api-modules.ts';

const journal = pino({ enabled: false });
const CODE = 'export default function activer() {}';
const EMPREINTE = 'a'.repeat(64);
const EMPREINTE_NOUVELLE = 'b'.repeat(64);
const MANIFESTE = {
  id: 'carte',
  nom: 'Carte',
  version: '1.0.0',
  description: 'Test',
  icone: 'map',
  point: 'index.js',
  emplacements: ['panneau'],
};

function fauxPoste(machine: string): ServerWebSocket<DonneesPoste> {
  return { data: { machine } } as unknown as ServerWebSocket<DonneesPoste>;
}

function montage(): { postes: Postes; registre: Registre; recus: MessageClient[] } {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  const diffusion = new Diffusion();
  const recus: MessageClient[] = [];
  const ws = { send: (t: string) => recus.push(JSON.parse(t) as MessageClient) };
  diffusion.ajouter(ws as unknown as ServerWebSocket<unknown>);
  const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
  return { postes, registre, recus };
}

const FICHIER_CODE = { chemin: 'index.js', base64: Buffer.from(CODE).toString('base64') };

function moduleMsg(empreinte: string, fichiers = [FICHIER_CODE]): string {
  return JSON.stringify({ kind: 'module', id: 'carte', manifeste: MANIFESTE, fichiers, empreinte });
}

function compte(recus: MessageClient[]): number {
  return recus.filter((m) => m.type === 'modules_modifies').length;
}

function url(chemin: string): Request {
  return new Request(`http://relais.test/api/modules/carte/${chemin}`);
}

describe('réception des modules', () => {
  test('un module reçu est listé, et la diffusion le signale une seule fois pour un même contenu', async () => {
    const { postes, registre, recus } = montage();
    postes.recu(fauxPoste('tour'), moduleMsg(EMPREINTE));
    postes.recu(fauxPoste('tour'), moduleMsg(EMPREINTE));
    expect(compte(recus)).toBe(1);
    const liste = (await lireModules(registre).json()) as Array<Record<string, unknown>>;
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({
      id: 'carte',
      empreinte: EMPREINTE,
      machine: 'tour',
      erreur: null,
      manifeste: MANIFESTE,
    });
    expect(typeof liste[0]?.['maj_le']).toBe('string');
  });

  test('une nouvelle empreinte remplace le module et diffuse modules_modifies', async () => {
    const { postes, registre, recus } = montage();
    postes.recu(fauxPoste('tour'), moduleMsg(EMPREINTE));
    postes.recu(fauxPoste('tour'), moduleMsg(EMPREINTE_NOUVELLE));
    expect(compte(recus)).toBe(2);
    const liste = (await lireModules(registre).json()) as Array<{ empreinte: string }>;
    expect(liste.map((m) => m.empreinte)).toEqual([EMPREINTE_NOUVELLE]);
  });

  test('module_retire supprime le module de la liste et le signale', async () => {
    const { postes, registre, recus } = montage();
    postes.recu(fauxPoste('tour'), moduleMsg(EMPREINTE));
    postes.recu(fauxPoste('tour'), JSON.stringify({ kind: 'module_retire', id: 'carte' }));
    expect(compte(recus)).toBe(2);
    expect(await lireModules(registre).json()).toEqual([]);
  });

  test('module_erreur apparaît dans la liste avec son erreur, sans fichiers servis', async () => {
    const { postes, registre } = montage();
    postes.recu(
      fauxPoste('tour'),
      JSON.stringify({ kind: 'module_erreur', id: 'carte', erreur: 'module.json : id absent' }),
    );
    const liste = (await lireModules(registre).json()) as Array<Record<string, unknown>>;
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({
      id: 'carte',
      erreur: 'module.json : id absent',
      manifeste: null,
      empreinte: null,
    });
    expect((await servirFichierModule(registre, url('index.js'))).status).toBe(404);
  });

  test('un module retiré par une autre machine que celle qui le possède ne bouge pas', async () => {
    const { postes, registre, recus } = montage();
    postes.recu(fauxPoste('tour'), moduleMsg(EMPREINTE));
    postes.recu(fauxPoste('portable'), JSON.stringify({ kind: 'module_retire', id: 'carte' }));
    expect(compte(recus)).toBe(1);
    expect(await lireModules(registre).json()).toHaveLength(1);
  });
});

describe('service des fichiers', () => {
  test('un fichier est servi avec le type MIME de son extension', async () => {
    const { postes, registre } = montage();
    const css = Buffer.from('.a { color: red; }').toString('base64');
    postes.recu(
      fauxPoste('tour'),
      moduleMsg(EMPREINTE, [
        { chemin: 'index.js', base64: Buffer.from(CODE).toString('base64') },
        { chemin: 'styles/carte.css', base64: css },
      ]),
    );
    const js = await servirFichierModule(registre, url('index.js'));
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(await js.text()).toBe(CODE);
    const feuille = await servirFichierModule(registre, url('styles/carte.css'));
    expect(feuille.headers.get('content-type')).toContain('text/css');
    expect(await feuille.text()).toBe('.a { color: red; }');
  });

  test('un chemin qui sort du module est refusé', async () => {
    const { postes, registre } = montage();
    postes.recu(fauxPoste('tour'), moduleMsg(EMPREINTE));
    const r = await servirFichierModule(registre, new Request('http://relais.test/api/modules/carte/..%2fsecret'));
    expect(r.status).toBe(400);
  });

  test('un fichier absent du module renvoie 404', async () => {
    const { postes, registre } = montage();
    postes.recu(fauxPoste('tour'), moduleMsg(EMPREINTE));
    expect((await servirFichierModule(registre, url('absent.js'))).status).toBe(404);
  });
});
