/**
 * M-53 — Propriété 2/5 : ISOLATION (03-couche-1.md, critère de réussite).
 *
 * « L'échec d'une équipe n'affecte aucune autre. »
 *
 * Deux angles, assemblés sur du VRAI code de production (pas de doublure du composant
 * sous test lui-même) :
 *
 *  A. Chargement de projets (F.4) : un fichier de config corrompu pour le projet B ne
 *     dégrade jamais le projet A déjà chargé — `chargerProjets` réel, fs réel.
 *  B. Fencing par epoch (D.2.3, panne #2) : deux missions sur DEUX worktrees distincts
 *     n'interfèrent jamais l'une avec l'autre dans l'arbitrage — `arbitrerFencing` réel.
 *
 * `☠ CONDITION SOUS LAQUELLE CETTE PROPRIÉTÉ CESSE DE TENIR` (croisement obligatoire avec
 * `TODO.md`, dette n°1) : le fencing par epoch n'arbitre qu'entre CANDIDATS CONNUS du
 * `RegistreWorkers` en mémoire du superviseur PC (voir `superviseur-workers.ts`,
 * `#arbitrerFencingWorktree` : `concurrents` vient de `this.#registre.tous()`). Si le
 * superviseur PC redémarre, ce registre repart VIDE — un worker resté vivant sur le PC
 * mais absent du nouveau registre n'est plus un « concurrent » pour l'arbitre : le test
 * ci-dessous le démontre en simulant explicitement cette perte de mémoire. L'isolation
 * entre missions SUR LE MÊME WORKTREE (reprise séquentielle après crash du superviseur)
 * n'est donc PAS garantie par ce mécanisme dans ce cas précis — seule l'isolation entre
 * missions sur des worktrees DIFFÉRENTS (le cas testé en A et le cas nominal de B) est
 * mécaniquement indépendante de cette dette.
 */

import { describe, expect, test } from 'bun:test';
import { chargerProjets } from '../projets/chargeur-projets.ts';
import { InterrogateurGitFactice } from '../projets/git-projet-factice.ts';
import type { ConfigProjetBrute } from '../projets/types.ts';
import { arbitrerFencing, type DetenteurEpoch } from '../superviseur/fencing-epoch.ts';

const DEPOT = '/tmp/claude-1000/-home-trinity/c97df358-b841-4cbd-abe9-02ef3a090c67/scratchpad/projets-tests/depot-git';

function brute(id: string, surcharge: Partial<ConfigProjetBrute> = {}): ConfigProjetBrute {
  return { id, cheminDepot: DEPOT, brancheDefaut: 'main', budgetMaxUsd: 40, modeleDefaut: 'sonnet', ...surcharge };
}

describe('isolation A — F.4.3 : un fichier de projet cassé ne dégrade aucun autre projet', () => {
  test('projet A valide + projet B corrompu (JSON invalide) chargés dans le même lot', async () => {
    const deps = {
      interrogateurGit: new InterrogateurGitFactice({ depots: new Set([DEPOT]), branches: new Map([[DEPOT, new Set(['main'])]]) }),
      listerFichiers: async () => ['alpha.json', 'beta.json'],
      lireFichier: async (chemin: string) => {
        if (chemin === 'alpha.json') return JSON.stringify(brute('alpha'));
        if (chemin === 'beta.json') return '{ "id": "beta", NE FERME PAS';
        throw new Error(`fichier factice inattendu : ${chemin}`);
      },
    };

    const resultat = await chargerProjets('/config', deps);

    expect(resultat.projets).toHaveLength(1);
    expect(resultat.projets[0]?.id).toBe('alpha');
    expect(resultat.rejetes).toHaveLength(1);
    expect(resultat.rejetes[0]?.echecs[0]?.code).toBe('json_invalide');
  });

  test('projet A valide + projet B avec budget invalide : A reste identique, seul B est écarté', async () => {
    const deps = {
      interrogateurGit: new InterrogateurGitFactice({ depots: new Set([DEPOT]), branches: new Map([[DEPOT, new Set(['main'])]]) }),
      listerFichiers: async () => ['alpha.json', 'beta.json'],
      lireFichier: async (chemin: string) => {
        if (chemin === 'alpha.json') return JSON.stringify(brute('alpha'));
        if (chemin === 'beta.json') return JSON.stringify(brute('beta', { budgetMaxUsd: -1 }));
        throw new Error(`fichier factice inattendu : ${chemin}`);
      },
    };

    const resultat = await chargerProjets('/config', deps);

    expect(resultat.projets.map((p) => p.id)).toEqual(['alpha']);
    expect(resultat.projets[0]?.budgetMaxUsd).toBe(40); // intact, jamais touché par l'échec de beta
    expect(resultat.rejetes[0]?.idPresume).toBe('beta');
  });
});

describe('isolation B — D.2.3 : deux missions sur deux worktrees distincts n’interfèrent jamais', () => {
  test('une revendication sur le worktree "beta" ignore totalement les détenteurs de "alpha"', () => {
    // `arbitrerFencing` est appelé PAR worktree (voir `#arbitrerFencingWorktree` : le
    // filtre `worktree === demande.spec.cwd` a déjà eu lieu avant l'appel). On le
    // reproduit ici explicitement : les détenteurs d'alpha ne sont jamais transmis à
    // l'arbitrage du candidat sur beta.
    const detenteursAlpha: readonly DetenteurEpoch[] = [{ sessionId: 'sess-alpha', epoch: 5 }];
    const candidatBeta: DetenteurEpoch = { sessionId: 'sess-beta', epoch: 1 };

    // Simule l'appelant réel : filtrage par worktree AVANT l'arbitrage — beta n'a
    // aucun concurrent, quel que soit l'état d'alpha.
    const concurrentsBeta: readonly DetenteurEpoch[] = [];
    void detenteursAlpha; // documente ce qui existe ailleurs, sans jamais y entrer

    expect(arbitrerFencing(concurrentsBeta, candidatBeta)).toEqual({ type: 'accepte' });
  });

  test('évincer un détenteur périmé sur alpha ne touche à rien sur beta (fonction pure, aucun état partagé)', () => {
    const decisionAlpha = arbitrerFencing([{ sessionId: 'alpha-ancien', epoch: 1 }], { sessionId: 'alpha-nouveau', epoch: 2 });
    const decisionBeta = arbitrerFencing([], { sessionId: 'beta-seul', epoch: 1 });

    expect(decisionAlpha).toEqual({ type: 'accepte_evince', sessionsAEvincer: ['alpha-ancien'] });
    expect(decisionBeta).toEqual({ type: 'accepte' }); // jamais affecté par l'éviction d'alpha
  });
});

describe('isolation — CONDITION : dette n°1 (registre de workers en mémoire) fait perdre l’arbitrage', () => {
  test('après un "redémarrage du superviseur PC" (registre vidé), un worker resté vivant n’est plus vu comme concurrent', () => {
    // Avant redémarrage : un worker légitime détient "alpha" à l'epoch 3. Le
    // superviseur PC (process réel) le sait via `RegistreWorkers.tous()`.
    const concurrentsAvantRedemarrage: readonly DetenteurEpoch[] = [{ sessionId: 'sess-legitime', epoch: 3 }];
    const decisionAvant = arbitrerFencing(concurrentsAvantRedemarrage, { sessionId: 'sess-legitime', epoch: 3 });
    // (égalité avec soi-même : l'appelant réel filtre le candidat de la liste des
    // concurrents avant d'arbitrer — ici on ne fait qu'illustrer l'état "avant".)
    void decisionAvant;

    // Le superviseur PC redémarre : `RegistreWorkers` (superviseur/registre-workers.ts)
    // est une simple `Map` en mémoire (`readonly #parSession = new Map(...)`), recréée
    // vide au redémarrage du process — AUCUNE persistance disque (dette n°1, TODO.md).
    // `sess-legitime` continue pourtant de tourner et d'écrire dans le worktree "alpha".
    const concurrentsApresRedemarrage: readonly DetenteurEpoch[] = []; // registre neuf, vide

    // Un candidat quelconque, même à un epoch bas, est accepté SANS ÉVICTION —
    // l'arbitre ne sait même pas qu'il devrait évincer quelqu'un.
    const decisionApres = arbitrerFencing(concurrentsApresRedemarrage, { sessionId: 'sess-intrus', epoch: 1 });

    expect(decisionApres).toEqual({ type: 'accepte' });
    // ⚠ Ceci est la preuve mécanique de la limite documentée en tête de fichier :
    // deux process (`sess-legitime`, encore vivant sur disque, et `sess-intrus`,
    // fraîchement accepté) peuvent désormais écrire dans le même worktree "alpha"
    // SANS qu'aucune erreur ne le signale — exactement la panne #2 de la grille de
    // revue, réintroduite par un canal que M-11 ne couvre pas et n'a jamais prétendu
    // couvrir (hors périmètre M-11, signalé dans TODO.md).
  });
});
