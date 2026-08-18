/**
 * Tests de l'outil `ma_depense` (mandat opérateur, 18/08) — l'outil qui donne
 * au lead la connaissance de SA PROPRE dépense. Deux garanties à couvrir :
 *  - il rend bien la dépense et le plafond, avec la bonne origine du plafond ;
 *  - il ne modifie AUCUN état — le lecteur injecté n'est qu'INTERROGÉ, jamais
 *    muté par l'appel de l'outil (voir la dernière `describe`).
 */

import { describe, expect, test } from 'bun:test';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { construireOutilsDepense, type DependancesServeurDepense, type DepenseMission } from './serveur.ts';

function contenuJson(resultat: CallToolResult): Record<string, unknown> {
  const bloc = resultat.content[0];
  if (bloc === undefined || bloc.type !== 'text') throw new Error('bloc de contenu inattendu en test');
  return JSON.parse(bloc.text) as Record<string, unknown>;
}

type HandlerGenerique = (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>;

function outilMaDepense(deps: DependancesServeurDepense): { readonly handler: HandlerGenerique } {
  const outil = construireOutilsDepense(deps).find((o) => o.name === 'ma_depense');
  if (outil === undefined) throw new Error('outil "ma_depense" introuvable en test');
  return outil as unknown as { handler: HandlerGenerique };
}

describe('ma_depense — ce qu’il rend', () => {
  test('coût, plafond et part consommée', async () => {
    const deps: DependancesServeurDepense = {
      sessionId: 's-1',
      plafondUsd: 20,
      plafondPropre: true,
      lecteurDepense: () => ({ coutUsd: 5, contexteTokensUtilises: 1000, contexteTokensMax: 4000 }),
    };
    const resultat = contenuJson(await outilMaDepense(deps).handler({}, undefined));
    expect(resultat['coutUsd']).toBe(5);
    expect(resultat['plafondUsd']).toBe(20);
    expect(resultat['pourcentageConsomme']).toBe(25);
    expect(resultat['contexteTokensUtilises']).toBe(1000);
    expect(resultat['contexteTokensMax']).toBe(4000);
  });

  test('plafond PROPRE annoncé comme tel', async () => {
    const deps: DependancesServeurDepense = {
      sessionId: 's-1',
      plafondUsd: 20,
      plafondPropre: true,
      lecteurDepense: () => null,
    };
    const resultat = contenuJson(await outilMaDepense(deps).handler({}, undefined));
    expect(resultat['plafondPropre']).toBe(true);
    expect(resultat['note']).toContain('propre à cette mission');
  });

  test('aucun plafond propre ⇒ l’indication du plafond de parc, jamais un silence', async () => {
    const deps: DependancesServeurDepense = {
      sessionId: 's-1',
      plafondUsd: 250,
      plafondPropre: false,
      lecteurDepense: () => null,
    };
    const resultat = contenuJson(await outilMaDepense(deps).handler({}, undefined));
    expect(resultat['plafondPropre']).toBe(false);
    expect(resultat['note']).toContain('plafond de parc');
  });

  test('mission tout juste démarrée (télémétrie pas encore ouverte) ⇒ coût à 0, jamais une erreur', async () => {
    const deps: DependancesServeurDepense = {
      sessionId: 's-1',
      plafondUsd: 20,
      plafondPropre: false,
      lecteurDepense: () => null,
    };
    const resultat = contenuJson(await outilMaDepense(deps).handler({}, undefined));
    expect(resultat['coutUsd']).toBe(0);
    expect(resultat['pourcentageConsomme']).toBe(0);
  });

  test('☠ le lecteur qui explose ne fait jamais échouer l’appel d’outil', async () => {
    const deps: DependancesServeurDepense = {
      sessionId: 's-1',
      plafondUsd: 20,
      plafondPropre: false,
      lecteurDepense: () => {
        throw new Error('collecteur indisponible');
      },
    };
    const resultat = contenuJson(await outilMaDepense(deps).handler({}, undefined));
    expect(resultat['erreur']).toBeDefined();
  });
});

describe('☠ ma_depense est une LECTURE PURE — aucun effet de bord', () => {
  test('le lecteur injecté n’est qu’INTERROGÉ, jamais muté — deux appels rendent le même résultat', async () => {
    // Doublure qui se comporterait comme `CollecteurTelemetrie.tous()` (DRAINANT)
    // si l'outil la traitait mal : elle consomme sa propre file au premier accès.
    // Ce test prouve que l'outil ne provoque pas ce drain — il ne fait que LIRE
    // ce que `lecteurDepense` lui rend, à chaque appel, sans état interne à lui.
    let appels = 0;
    const source: DepenseMission = { coutUsd: 3, contexteTokensUtilises: 500, contexteTokensMax: 4000 };
    const deps: DependancesServeurDepense = {
      sessionId: 's-1',
      plafondUsd: 10,
      plafondPropre: true,
      lecteurDepense: () => {
        appels += 1;
        return source; // toujours LE MÊME objet — rien n'est retiré nulle part
      },
    };
    const outil = outilMaDepense(deps);
    const premier = contenuJson(await outil.handler({}, undefined));
    const second = contenuJson(await outil.handler({}, undefined));
    expect(premier).toEqual(second);
    expect(appels).toBe(2); // une interrogation par appel, aucun cache qui masquerait une mutation
  });
});
