// Responsabilité : tests de l'ouverture d'une session — validation, appel du relais, session simulée de la démo.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { MagasinMonde } from './monde-etat';
import { creerOuvertureDemo, creerOuvertureRelais, validerOuverture, type DemandeOuverture } from './ouverture';
import type { Recuperer } from './transport-http';

const PROJET = { machine: 'poste-a', chemin: '/demo/agent-hq', nom: 'agent-hq' };
const DEMANDE: DemandeOuverture = { machine: 'poste-a', projet: PROJET, message: '  Corrige le HUD  ', titre: 'HUD' };

describe('validation', () => {
  test('refuse un message vide, un projet d une autre machine, accepte une demande complète', () => {
    expect(validerOuverture({ ...DEMANDE, message: '   ' })).toBe('le premier message est obligatoire');
    expect(validerOuverture({ ...DEMANDE, machine: 'poste-b' })).toBe('ce projet n\'est pas sur cette machine');
    expect(validerOuverture({ ...DEMANDE, machine: '' })).toBe('choisis une machine');
    expect(validerOuverture(DEMANDE)).toBeNull();
  });
});

describe('relais', () => {
  test('POST /api/sessions avec le jeton, corps nettoyé, id de la session rendu', async () => {
    const appels: { url: string; init: RequestInit }[] = [];
    const recuperer: Recuperer = async (url, init) => {
      appels.push({ url, init });
      return Response.json({ id: 'abc', statut: 'demarrage' }, { status: 201 });
    };
    const r = await creerOuvertureRelais({ base: 'http://r/', jeton: 'j', recuperer }).ouvrir({
      ...DEMANDE,
      modele: 'claude-sonnet-5-5',
    });
    expect(r).toEqual({ ok: true, sessionId: 'abc' });
    expect(appels[0]?.url).toBe('http://r/api/sessions');
    expect(new Headers(appels[0]?.init.headers).get('authorization')).toBe('Bearer j');
    expect(JSON.parse(String(appels[0]?.init.body))).toEqual({
      machine: 'poste-a', projet: PROJET, message: 'Corrige le HUD', titre: 'HUD', modele: 'claude-sonnet-5-5',
    });
  });

  test('un refus du relais rend son message d erreur', async () => {
    const recuperer: Recuperer = async () => Response.json({ erreur: 'machine hors ligne' }, { status: 502 });
    const r = await creerOuvertureRelais({ base: 'http://r', jeton: 'j', recuperer }).ouvrir(DEMANDE);
    expect(r).toEqual({ ok: false, erreur: 'machine hors ligne' });
  });

  test('un relais injoignable ne lève pas', async () => {
    const recuperer: Recuperer = async () => {
      throw new Error('réseau');
    };
    const r = await creerOuvertureRelais({ base: 'http://r', jeton: 'j', recuperer }).ouvrir(DEMANDE);
    expect(r.ok).toBe(false);
  });

  test('une demande invalide n appelle pas le relais', async () => {
    let appele = false;
    const recuperer: Recuperer = async () => {
      appele = true;
      return new Response('{}');
    };
    const service = creerOuvertureRelais({ base: 'http://r', jeton: 'j', recuperer });
    const r = await service.ouvrir({ ...DEMANDE, message: '' });
    expect(r.ok).toBe(false);
    expect(appele).toBe(false);
  });
});

describe('démo', () => {
  test('ajoute une session en démarrage avec le message, puis la met au travail', async () => {
    const magasin = new MagasinMonde();
    const differes: (() => void)[] = [];
    const service = creerOuvertureDemo(magasin, { horloge: () => 0, minuteur: (fn) => differes.push(fn) });
    const r = await service.ouvrir({ ...DEMANDE, modele: 'claude-haiku-5-5' });
    expect(r).toEqual({ ok: true, sessionId: 'demo-nouvelle-1' });
    const s = magasin.lire().sessions[0];
    expect(s?.statut).toBe('demarrage');
    expect(s?.modele).toBe('claude-haiku-5-5');
    expect(s?.titre).toBe('HUD');
    expect(magasin.lire().fil['demo-nouvelle-1']?.[0]?.evt).toEqual({ type: 'message', texte: 'Corrige le HUD' });
    differes.forEach((f) => f());
    expect(magasin.lire().sessions[0]?.statut).toBe('travail');
    expect(magasin.lire().fil['demo-nouvelle-1']?.length).toBe(2);
  });

  test('sans titre, le titre vient du message ; ids successifs distincts', async () => {
    const magasin = new MagasinMonde();
    const service = creerOuvertureDemo(magasin, { minuteur: () => undefined });
    await service.ouvrir({ ...DEMANDE, titre: '' });
    const r = await service.ouvrir(DEMANDE);
    expect(magasin.lire().sessions[0]?.titre).toBe('Corrige le HUD');
    expect(r).toEqual({ ok: true, sessionId: 'demo-nouvelle-2' });
  });
});
