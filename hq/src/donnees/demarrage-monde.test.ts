// Responsabilité : tests du branchement source → magasin, y compris la resynchronisation après une coupure du flux.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { EtatRelais, EvenementDate, MessageClient } from './contrat';
import { demarrerMonde } from './demarrage-monde';
import { MagasinMonde } from './monde-etat';
import type { ApiMonde, EcouteurSource, EtatLien, SourceMonde } from './source-monde';

function etat(version: number, sessionIds: string[]): EtatRelais {
  const sessions = sessionIds.map((id) => ({ id }) as unknown as EtatRelais['sessions'][number]);
  return { version, machines: [], sessions, notifications: [], reveilPossible: [] };
}

function sourceFactice(): { source: SourceMonde; ecouteur: () => EcouteurSource | null; compteurEtat: () => number } {
  let ecouteur: EcouteurSource | null = null;
  let compteur = 0;
  const api: ApiMonde = {
    envoyerMessage: async () => undefined,
    repondre: async () => undefined,
    agir: async () => undefined,
  };
  const source: SourceMonde = {
    nom: 'demo',
    api,
    etatInitial: async () => {
      compteur += 1;
      return etat(compteur, ['s1']);
    },
    evenements: async (): Promise<EvenementDate[]> => [],
    demarrer: (e) => {
      ecouteur = e;
    },
    arreter: () => undefined,
  };
  return { source, ecouteur: () => ecouteur, compteurEtat: () => compteur };
}

describe('demarrerMonde', () => {
  test('charge l état initial puis transmet les messages du flux au magasin', async () => {
    const { source, ecouteur } = sourceFactice();
    const magasin = new MagasinMonde();
    await demarrerMonde(source, magasin);
    const message: MessageClient = { type: 'echo', echo: {} };
    ecouteur()?.surMessage(message);
    expect(magasin.lire().sessions.map((s) => s.id)).toEqual(['s1']);
  });

  test('après une coupure, la reconnexion resynchronise l état du monde', async () => {
    const { source, ecouteur, compteurEtat } = sourceFactice();
    const magasin = new MagasinMonde();
    await demarrerMonde(source, magasin);
    const liens: EtatLien[] = ['ouvert', 'coupe', 'connexion', 'ouvert'];
    for (const lien of liens) ecouteur()?.surLien(lien);
    await new Promise((r) => setTimeout(r, 0));
    expect(compteurEtat()).toBe(2);
    expect(magasin.lire().lien).toBe('ouvert');
  });

  test('l arrêt renvoie une fonction qui arrête la source', async () => {
    let arrete = false;
    const { source } = sourceFactice();
    const arret = await demarrerMonde({ ...source, arreter: () => (arrete = true) }, new MagasinMonde());
    arret();
    expect(arrete).toBe(true);
  });
});
