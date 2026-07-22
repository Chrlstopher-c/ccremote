/**
 * Tests de `validerConfigProjet` (F.1.2, F.4.2).
 *
 * `☠ CASSE` visé : un projet invalide doit être écarté **entièrement** —
 * `config === null` dès qu'un seul contrôle échoue, jamais une forme partielle.
 * Chemins réels utilisés uniquement sous le scratchpad de session (répertoires
 * créés par cette mission), jamais sur un dépôt réel du poste.
 */

import { describe, expect, test } from 'bun:test';
import { MAX_MOTIFS_SUPPLEMENTAIRES_PROJET, validerConfigProjet } from './validation-config.ts';
import { InterrogateurGitFactice } from './git-projet-factice.ts';
import type { ConfigProjetBrute } from './types.ts';

const RACINE = '/tmp/claude-1000/-home-trinity/c97df358-b841-4cbd-abe9-02ef3a090c67/scratchpad/projets-tests';
const DEPOT_GIT = `${RACINE}/depot-git`;
const DEPOT_NON_GIT = `${RACINE}/depot-non-git`;
const FICHIER_PAS_DOSSIER = `${RACINE}/fichier-pas-dossier-cible`;

function git(options: { depots?: string[]; branches?: [string, string[]][] } = {}): InterrogateurGitFactice {
  return new InterrogateurGitFactice({
    depots: new Set(options.depots ?? []),
    branches: new Map((options.branches ?? []).map(([d, bs]) => [d, new Set(bs)])),
  });
}

function configValide(surcharge: Partial<ConfigProjetBrute> = {}): ConfigProjetBrute {
  return {
    id: 'projet-alpha',
    cheminDepot: DEPOT_GIT,
    brancheDefaut: 'main',
    budgetMaxUsd: 50,
    modeleDefaut: 'sonnet',
    ...surcharge,
  };
}

describe('validerConfigProjet — cas nominal', () => {
  test('accepte une configuration git complète et correcte', async () => {
    const deps = { interrogateurGit: git({ depots: [DEPOT_GIT], branches: [[DEPOT_GIT, ['main']]] }) };
    const { config, echecs } = await validerConfigProjet(configValide(), 'x.json', deps);
    expect(echecs).toEqual([]);
    expect(config).not.toBeNull();
    expect(config?.id).toBe('projet-alpha');
    expect(config?.estGit).toBe(true);
    expect(config?.isolationGarantie).toBe(true);
    expect(config?.brancheDefaut).toBe('main');
  });

  test('mandatType retombe sur "standard" si absent', async () => {
    const deps = { interrogateurGit: git({ depots: [DEPOT_GIT], branches: [[DEPOT_GIT, ['main']]] }) };
    const { config } = await validerConfigProjet(configValide(), 'x.json', deps);
    expect(config?.mandatType).toBe('standard');
  });
});

describe('validerConfigProjet — F.1.3, projet non-git', () => {
  test('accepte un projet non-git sans brancheDefaut, isolation non garantie', async () => {
    const deps = { interrogateurGit: git({ depots: [] }) };
    const { config, echecs } = await validerConfigProjet(
      configValide({ cheminDepot: DEPOT_NON_GIT, brancheDefaut: undefined }),
      'x.json',
      deps,
    );
    expect(echecs).toEqual([]);
    expect(config?.estGit).toBe(false);
    expect(config?.isolationGarantie).toBe(false);
    expect(config?.brancheDefaut).toBeNull();
  });

  test('rejette brancheDefaut fixée sur un projet non-git — signalé, pas ignoré', async () => {
    const deps = { interrogateurGit: git({ depots: [] }) };
    const { config, echecs } = await validerConfigProjet(configValide({ cheminDepot: DEPOT_NON_GIT }), 'x.json', deps);
    expect(config).toBeNull();
    expect(echecs).toEqual([{ code: 'branche_defaut_sur_projet_non_git', detail: expect.any(String) }]);
  });
});

describe('validerConfigProjet — F.4.2, validation exhaustive avant écart', () => {
  test('id invalide et chemin introuvable sont TOUS DEUX rapportés, aucun n’est masqué', async () => {
    const deps = { interrogateurGit: git() };
    const { config, echecs } = await validerConfigProjet(
      { ...configValide(), id: 'ID INVALIDE !', cheminDepot: '/inexistant-vraiment' },
      'x.json',
      deps,
    );
    expect(config).toBeNull();
    const codes = echecs.map((e) => e.code).sort();
    expect(codes).toEqual(['chemin_depot_introuvable', 'id_manquant_ou_invalide']);
  });

  test('chemin pointant vers un fichier (pas un répertoire) est rejeté', async () => {
    const deps = { interrogateurGit: git() };
    const { config, echecs } = await validerConfigProjet(configValide({ cheminDepot: FICHIER_PAS_DOSSIER }), 'x.json', deps);
    expect(config).toBeNull();
    expect(echecs[0]?.code).toBe('chemin_depot_pas_un_repertoire');
  });

  test('branche par défaut absente sur un dépôt git est rejetée', async () => {
    const deps = { interrogateurGit: git({ depots: [DEPOT_GIT] }) };
    const { config, echecs } = await validerConfigProjet(configValide({ brancheDefaut: undefined }), 'x.json', deps);
    expect(config).toBeNull();
    expect(echecs[0]?.code).toBe('branche_defaut_manquante_pour_depot_git');
  });

  test('branche par défaut inexistante dans le dépôt est rejetée', async () => {
    const deps = { interrogateurGit: git({ depots: [DEPOT_GIT], branches: [[DEPOT_GIT, ['autre-chose']]] }) };
    const { config, echecs } = await validerConfigProjet(configValide(), 'x.json', deps);
    expect(config).toBeNull();
    expect(echecs[0]?.code).toBe('branche_defaut_introuvable');
  });

  test.each([-1, 0, NaN, Infinity, 'cent'])('budget invalide (%p) est rejeté', async (budget) => {
    const deps = { interrogateurGit: git({ depots: [DEPOT_GIT], branches: [[DEPOT_GIT, ['main']]] }) };
    // Valeur volontairement hors-type (nombre invalide ou chaîne) pour prouver le rejet (F.4.2).
    const { config, echecs } = await validerConfigProjet(configValide({ budgetMaxUsd: budget as unknown as number }), 'x.json', deps);
    expect(config).toBeNull();
    expect(echecs[0]?.code).toBe('budget_invalide');
  });
});

describe('validerConfigProjet — panne #20, plancher Sonnet sur le modèle résolu (H-43)', () => {
  const deps = { interrogateurGit: git({ depots: [DEPOT_GIT], branches: [[DEPOT_GIT, ['main']]] }) };

  test('rejette haiku, sous le plancher', async () => {
    const { config, echecs } = await validerConfigProjet(configValide({ modeleDefaut: 'claude-haiku-4-5' }), 'x.json', deps);
    expect(config).toBeNull();
    expect(echecs[0]?.code).toBe('modele_defaut_invalide');
  });

  test('rejette "inherit" — aucune cascade à ce stade, ne pas valider sur l’alias', async () => {
    const { config, echecs } = await validerConfigProjet(configValide({ modeleDefaut: 'inherit' }), 'x.json', deps);
    expect(config).toBeNull();
    expect(echecs[0]?.code).toBe('modele_defaut_invalide');
  });

  test('accepte opus et sonnet', async () => {
    const opus = await validerConfigProjet(configValide({ modeleDefaut: 'claude-opus-4-6' }), 'x.json', deps);
    expect(opus.config).not.toBeNull();
    const sonnet = await validerConfigProjet(configValide({ modeleDefaut: 'sonnet' }), 'x.json', deps);
    expect(sonnet.config).not.toBeNull();
  });
});

describe('validerConfigProjet — panne #21, motifs de déni supplémentaires scopés', () => {
  const deps = { interrogateurGit: git({ depots: [DEPOT_GIT], branches: [[DEPOT_GIT, ['main']]] }) };

  test('accepte un motif scopé', async () => {
    const { config, echecs } = await validerConfigProjet(
      configValide({
        deniedToolPatternsSupplementaires: [
          { id: 'proprietaire', outil: 'Bash', contenuRegle: '*publish-registry-prive*', porte: 'x', nonQuotidien: 'y' },
        ],
      }),
      'x.json',
      deps,
    );
    expect(echecs).toEqual([]);
    expect(config?.deniedToolPatternsSupplementaires).toHaveLength(1);
  });

  test('rejette un motif au nom d’outil nu (contenuRegle vide)', async () => {
    const { config, echecs } = await validerConfigProjet(
      configValide({
        deniedToolPatternsSupplementaires: [{ id: 'nu', outil: 'Bash', contenuRegle: '', porte: 'x', nonQuotidien: 'y' }],
      }),
      'x.json',
      deps,
    );
    expect(config).toBeNull();
    expect(echecs[0]?.code).toBe('motif_deni_supplementaire_non_scope');
  });

  test('rejette des ids dupliqués', async () => {
    const motif = { id: 'm', outil: 'Bash' as const, contenuRegle: '*x*', porte: 'x', nonQuotidien: 'y' };
    const { config, echecs } = await validerConfigProjet(
      configValide({ deniedToolPatternsSupplementaires: [motif, motif] }),
      'x.json',
      deps,
    );
    expect(config).toBeNull();
    expect(echecs[0]?.code).toBe('motif_deni_supplementaire_id_duplique');
  });

  test(`rejette au-delà de ${MAX_MOTIFS_SUPPLEMENTAIRES_PROJET} motifs supplémentaires`, async () => {
    const motifs = Array.from({ length: MAX_MOTIFS_SUPPLEMENTAIRES_PROJET + 1 }, (_, i) => ({
      id: `m${i}`,
      outil: 'Bash' as const,
      contenuRegle: `*x${i}*`,
      porte: 'x',
      nonQuotidien: 'y',
    }));
    const { config, echecs } = await validerConfigProjet(configValide({ deniedToolPatternsSupplementaires: motifs }), 'x.json', deps);
    expect(config).toBeNull();
    expect(echecs[0]?.code).toBe('motif_deni_supplementaire_trop_nombreux');
  });
});

describe('validerConfigProjet — forme grossièrement invalide', () => {
  const deps = { interrogateurGit: git() };

  test('rejette null', async () => {
    const { config, echecs } = await validerConfigProjet(null, 'x.json', deps);
    expect(config).toBeNull();
    expect(echecs[0]?.code).toBe('forme_invalide');
  });

  test('rejette un tableau', async () => {
    const { config, echecs } = await validerConfigProjet([], 'x.json', deps);
    expect(config).toBeNull();
    expect(echecs[0]?.code).toBe('forme_invalide');
  });
});
