import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerLecteurDomainesEquipe } from './lecteur-domaines-equipe.ts';
import type { DependancesChargeur } from '../../projets/index.ts';
import { ouvrirRegistre, type Registre } from '../../control-plane/registre/index.ts';
import { proposerCreationEquipe } from '../../control-plane/orchestrateur/mcp-controle/outils-cycle-vie.ts';
import type { LecteurUtilisationParc } from '../../control-plane/orchestrateur/mcp-controle/types.ts';

let repoDir: string;
beforeEach(async () => {
  repoDir = await mkdtemp(join(tmpdir(), 'ccr-dom-'));
});
afterEach(async () => {
  await rm(repoDir, { recursive: true, force: true });
});

/** Chargeur injecté : un seul fichier de config, non-git (répertoire réel existant). */
function chargeurAvecConfig(config: Record<string, unknown>): DependancesChargeur {
  return {
    interrogateurGit: {
      estDepotGit: async () => false,
      existeBranche: async () => false,
      aTravailNonCommite: async () => false,
    },
    listerFichiers: async () => ['/config/vela.json'],
    lireFichier: async () => JSON.stringify(config),
  };
}

function configVela(): Record<string, unknown> {
  return {
    id: 'vela',
    cheminDepot: repoDir,
    budgetMaxUsd: 5,
    modeleDefaut: 'claude-opus-4-8',
    domainesEquipe: ['frontend', 'backend'],
  };
}

describe('creerLecteurDomainesEquipe — lookup Pi-local (branchement #4)', () => {
  test('☠ projet déclaré → rend sa liste FERMÉE de domaines', async () => {
    const lecteur = creerLecteurDomainesEquipe('/config', chargeurAvecConfig(configVela()));
    expect(await lecteur.domainesDe('vela')).toEqual(['frontend', 'backend']);
    // Match aussi par chemin de dépôt (un mandat désigne parfois le projet par cwd).
    expect(await lecteur.domainesDe(repoDir)).toEqual(['frontend', 'backend']);
  });

  test('projet NON déclaré → null (validation sautée, jamais un refus inventé)', async () => {
    const lecteur = creerLecteurDomainesEquipe('/config', chargeurAvecConfig(configVela()));
    expect(await lecteur.domainesDe('inconnu')).toBeNull();
  });
});

describe('proposerCreationEquipe — le lookup refuse/accepte réellement (D3)', () => {
  let registre: Registre;
  beforeEach(() => {
    registre = ouvrirRegistre({ chemin: ':memory:' });
  });
  afterEach(() => registre.fermer());

  const lecteurParc: LecteurUtilisationParc = {
    comptesConnus: () => [],
    releves: () => [],
  };

  test('☠ domaine HORS liste → REFUSÉ, avec la liste des domaines acceptés', async () => {
    const lecteur = creerLecteurDomainesEquipe('/config', chargeurAvecConfig(configVela()));
    const res = await proposerCreationEquipe(
      'vela',
      'brancher le bouton',
      'critère `bun test` vert',
      'src/**',
      'lecture',
      registre,
      lecteurParc,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'paiement', // domaine hors { frontend, backend }
      lecteur,
    );
    expect(res.ok).toBe(false);
    expect(res.raison).toContain('paiement');
    expect(res.raison).toContain('frontend');
    expect(res.raison).toContain('backend');
  });

  test('☠ domaine VALIDE → passe la porte du domaine (refus ultérieur = carburant, pas domaine)', async () => {
    const lecteur = creerLecteurDomainesEquipe('/config', chargeurAvecConfig(configVela()));
    const res = await proposerCreationEquipe(
      'vela',
      'brancher le bouton',
      'critère `bun test` vert',
      'src/**',
      'lecture',
      registre,
      lecteurParc,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'frontend', // domaine valide
      lecteur,
    );
    // Il est refusé plus loin (garde carburant non consulté), JAMAIS pour le domaine.
    expect(res.raison ?? '').not.toContain('domaine « frontend » inconnu');
    expect(res.raison ?? '').toContain('carburant');
  });
});
