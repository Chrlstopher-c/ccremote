// Responsabilité : tests des actions de session — chaque action passe par la bonne route, les erreurs ne remontent pas.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { creerActions } from './actions';
import type { ReponseDialogue } from './contrat';
import type { ApiMonde } from './source-monde';

function apiEspion(echec?: string): { api: ApiMonde; appels: string[] } {
  const appels: string[] = [];
  const operation = (nom: string): Promise<void> => {
    appels.push(nom);
    return echec ? Promise.reject(new Error(echec)) : Promise.resolve();
  };
  const api: ApiMonde = {
    envoyerMessage: (id, texte) => operation(`envoyer:${id}:${texte}`),
    repondre: (id: string, reponse: ReponseDialogue) => operation(`repondre:${id}:${reponse.id}`),
    agir: (id, action) => operation(`${action}:${id}`),
  };
  return { api, appels };
}

describe('creerActions', () => {
  test('chaque action appelle sa route et réussit', async () => {
    const { api, appels } = apiEspion();
    const actions = creerActions(api);
    await actions.envoyer('s1', 'bonjour');
    await actions.repondre('s1', { id: 'q1', index: 0 });
    await actions.interrompre('s1');
    await actions.compacter('s1');
    await actions.eteindre('s1');
    await actions.reprendre('s1');
    await actions.archiver('s1');
    const resultat = await actions.desarchiver('s1');
    expect(resultat).toEqual({ ok: true });
    expect(appels).toEqual([
      'envoyer:s1:bonjour',
      'repondre:s1:q1',
      'interrompre:s1',
      'compacter:s1',
      'fermer:s1',
      'reprendre:s1',
      'archiver:s1',
      'desarchiver:s1',
    ]);
  });

  test('un message vide est refusé sans appel', async () => {
    const { api, appels } = apiEspion();
    const resultat = await creerActions(api).envoyer('s1', '   ');
    expect(resultat.ok).toBe(false);
    expect(appels).toEqual([]);
  });

  test('une erreur de la source devient un résultat refusé, sans exception', async () => {
    const { api } = apiEspion('409 machine hors ligne');
    const resultat = await creerActions(api).eteindre('s1');
    expect(resultat).toEqual({ ok: false, erreur: '409 machine hors ligne' });
  });
});
