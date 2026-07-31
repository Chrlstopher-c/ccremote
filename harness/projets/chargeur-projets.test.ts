/**
 * Tests de `chargerProjets` (F.4).
 *
 * `☠ CASSE` visés :
 * - F.4.2 — un projet invalide est écarté, jamais chargé partiellement (aucune
 *   trace de lui dans `projets`, même partielle) ;
 * - F.4.3 — un fichier corrompu n'affecte aucun autre projet du même lot ;
 * - F.4.1 — rien n'est mis en cache entre deux appels (rechargement à chaud).
 *
 * `listerFichiers` / `lireFichier` sont injectés en mémoire : aucun répertoire
 * réel scruté ici. `cheminDepot` pointe vers le dépôt de scratchpad créé par
 * cette mission (jamais un dépôt réel du poste).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { creerRacineTemporaire } from '../test-harness/racine-temporaire.ts';
import { chargerProjets } from './chargeur-projets.ts';
import { InterrogateurGitFactice } from './git-projet-factice.ts';
import type { ConfigProjetBrute } from './types.ts';

const TMP = creerRacineTemporaire('ccremote-chargeur-projets-');
const DEPOT_GIT = TMP.sousRepertoire('depot-git');

afterAll(() => TMP.nettoyer());

function depsAvecFichiers(fichiers: Record<string, string>): {
  interrogateurGit: InterrogateurGitFactice;
  listerFichiers: () => Promise<string[]>;
  lireFichier: (chemin: string) => Promise<string>;
} {
  return {
    interrogateurGit: new InterrogateurGitFactice({ depots: new Set([DEPOT_GIT]), branches: new Map([[DEPOT_GIT, new Set(['main'])]]) }),
    listerFichiers: async () => Object.keys(fichiers),
    lireFichier: async (chemin: string) => {
      const contenu = fichiers[chemin];
      if (contenu === undefined) throw new Error(`fichier factice introuvable : ${chemin}`);
      return contenu;
    },
  };
}

function brute(surcharge: Partial<ConfigProjetBrute> = {}): ConfigProjetBrute {
  return { id: 'alpha', cheminDepot: DEPOT_GIT, brancheDefaut: 'main', budgetMaxUsd: 40, modeleDefaut: 'sonnet', ...surcharge };
}

describe('chargerProjets — F.4.1/F.4.2, cas nominal', () => {
  test('charge un projet valide, aucun rejet', async () => {
    const deps = depsAvecFichiers({ 'alpha.json': JSON.stringify(brute()) });
    const resultat = await chargerProjets('/config', deps);
    expect(resultat.rejetes).toEqual([]);
    expect(resultat.projets).toHaveLength(1);
    expect(resultat.projets[0]?.id).toBe('alpha');
  });

  test('un projet invalide est écarté ENTIÈREMENT — absent de `projets`, présent dans `rejetes`', async () => {
    const deps = depsAvecFichiers({ 'beta.json': JSON.stringify(brute({ id: 'beta', budgetMaxUsd: -5 })) });
    const resultat = await chargerProjets('/config', deps);
    expect(resultat.projets).toEqual([]);
    expect(resultat.rejetes).toHaveLength(1);
    expect(resultat.rejetes[0]?.idPresume).toBe('beta');
    expect(resultat.rejetes[0]?.echecs[0]?.code).toBe('budget_invalide');
  });
});

describe('chargerProjets — F.4.3, isolation entre fichiers', () => {
  test('un JSON corrompu n’empêche pas le chargement des projets valides du même lot', async () => {
    const deps = depsAvecFichiers({
      'corrompu.json': '{ ceci n’est pas du JSON',
      'alpha.json': JSON.stringify(brute({ id: 'alpha' })),
    });
    const resultat = await chargerProjets('/config', deps);
    expect(resultat.projets.map((p) => p.id)).toEqual(['alpha']);
    expect(resultat.rejetes).toHaveLength(1);
    expect(resultat.rejetes[0]?.echecs[0]?.code).toBe('json_invalide');
  });

  test('un projet invalide n’empêche pas le chargement d’un autre projet valide', async () => {
    const deps = depsAvecFichiers({
      'beta.json': JSON.stringify(brute({ id: 'beta', budgetMaxUsd: -1 })),
      'alpha.json': JSON.stringify(brute({ id: 'alpha' })),
    });
    const resultat = await chargerProjets('/config', deps);
    expect(resultat.projets.map((p) => p.id)).toEqual(['alpha']);
    expect(resultat.rejetes.map((r) => r.idPresume)).toEqual(['beta']);
  });

  test('deux fichiers déclarant le même id : le second est écarté, le premier reste chargé', async () => {
    const deps = depsAvecFichiers({
      'a-premier.json': JSON.stringify(brute({ id: 'alpha' })),
      'b-second.json': JSON.stringify(brute({ id: 'alpha' })),
    });
    const resultat = await chargerProjets('/config', deps);
    expect(resultat.projets).toHaveLength(1);
    expect(resultat.projets[0]?.fichierSource).toBe('a-premier.json');
    expect(resultat.rejetes).toHaveLength(1);
    expect(resultat.rejetes[0]?.echecs[0]?.code).toBe('id_deja_charge_dans_ce_lot');
  });
});

describe('chargerProjets — F.4.1, rechargement à chaud sans état résiduel', () => {
  test('un second appel avec un lot différent ne porte aucune trace du premier', async () => {
    const premier = depsAvecFichiers({ 'alpha.json': JSON.stringify(brute({ id: 'alpha' })) });
    const resultat1 = await chargerProjets('/config', premier);
    expect(resultat1.projets.map((p) => p.id)).toEqual(['alpha']);

    const second = depsAvecFichiers({ 'gamma.json': JSON.stringify(brute({ id: 'gamma' })) });
    const resultat2 = await chargerProjets('/config', second);
    expect(resultat2.projets.map((p) => p.id)).toEqual(['gamma']);
  });

  test('répertoire de config réel mais inexistant : lot vide, aucune exception propagée (défaut)', async () => {
    const deps = { interrogateurGit: new InterrogateurGitFactice() };
    await expect(chargerProjets('/config-vraiment-inexistant-xyz', deps)).resolves.toEqual({ projets: [], rejetes: [] });
  });
});
