/**
 * Un test par motif du plancher de déni (mission M-20, C.1.3, G.2).
 *
 * Chaque motif est démontré dans les deux sens :
 * - refus effectif sur une commande/chemin dangereux représentatif ;
 * - silence sur une commande/chemin représentatif du travail quotidien —
 *   sinon le motif gênerait le quotidien et serait contourné (panne #22,
 *   contrainte explicite de la mission : « pas plus de ~15 motifs »).
 *
 * Tout est exercé en `permissionMode: 'auto'` — le mode réellement utilisé en
 * production (H-40, H-42) — jamais `bypassPermissions` par défaut, pour ne pas
 * être vert pour la mauvaise raison. Un test dédié à la fin vérifie explicitement
 * que le verdict de déni ne change pas sous `bypassPermissions` (C.1.2/C.1.3).
 */

import { describe, expect, test } from 'bun:test';
import { composeWorkerOptions } from '../workers/index.ts';
import type { ResolvedModel, WorkerSpec } from '../workers/index.ts';
import {
  MAX_MOTIFS_PLANCHER,
  MotifNonScopeError,
  PLANCHER_DENI,
  PLANCHER_DENI_SDK,
  PlancherTropLargeError,
  assertIdsUniques,
  assertMotifsScopes,
  assertPlancherBorne,
  formatterRegleSdk,
  simulerArbitrage,
  validerPlancher,
} from './index.ts';
import type { MotifDeni } from './index.ts';

const MODE_PRODUCTION = 'auto' as const;

function refuse(cible: string, outil: MotifDeni['outil'] = 'Bash'): boolean {
  return simulerArbitrage(PLANCHER_DENI, { outil, cible }, MODE_PRODUCTION).refuse;
}

function motifResponsable(cible: string, outil: MotifDeni['outil'] = 'Bash'): string | null {
  return simulerArbitrage(PLANCHER_DENI, { outil, cible }, MODE_PRODUCTION).motifId;
}

describe('cadre — panne #21 (nom d’outil nu)', () => {
  test('aucun motif du plancher réel n’a de contenuRegle vide', () => {
    expect(() => assertMotifsScopes(PLANCHER_DENI)).not.toThrow();
  });

  test('un motif sans contenuRegle est détecté et rejeté', () => {
    const corrompu: MotifDeni[] = [
      { id: 'nu', outil: 'Bash', contenuRegle: '', porte: 'x', nonQuotidien: 'x' },
    ];
    expect(() => assertMotifsScopes(corrompu)).toThrow(MotifNonScopeError);
  });

  test('la forme SDK de chaque motif porte toujours un contenu entre parenthèses', () => {
    for (const motif of PLANCHER_DENI) {
      const regle = formatterRegleSdk(motif);
      expect(regle).toMatch(/^(Bash|Write|Edit)\(.+\)$/);
    }
  });
});

describe('cadre — panne #22 (plancher jamais testé / trop large)', () => {
  test('le plancher réel ne dépasse pas le plafond de la mission', () => {
    expect(PLANCHER_DENI.length).toBeLessThanOrEqual(MAX_MOTIFS_PLANCHER);
    expect(() => assertPlancherBorne(PLANCHER_DENI)).not.toThrow();
  });

  test('un plancher surdimensionné est détecté et rejeté', () => {
    const trop: MotifDeni[] = Array.from({ length: MAX_MOTIFS_PLANCHER + 1 }, (_, i) => ({
      id: `m${i}`,
      outil: 'Bash' as const,
      contenuRegle: `x${i}`,
      porte: 'x',
      nonQuotidien: 'x',
    }));
    expect(() => assertPlancherBorne(trop)).toThrow(PlancherTropLargeError);
  });

  test('identifiants de motifs tous uniques', () => {
    expect(() => assertIdsUniques(PLANCHER_DENI)).not.toThrow();
  });

  test('validerPlancher() passe sur le plancher réel', () => {
    expect(() => validerPlancher(PLANCHER_DENI)).not.toThrow();
  });
});

describe('motif rm-rf-racine', () => {
  test('refuse une suppression forcée depuis la racine', () => {
    expect(refuse('rm -rf /')).toBe(true);
    expect(refuse('rm -rf /etc')).toBe(true);
    expect(motifResponsable('rm -rf /var/lib/important')).toBe('rm-rf-racine');
  });

  test('laisse passer un nettoyage de worktree', () => {
    expect(refuse('rm -rf node_modules')).toBe(false);
    expect(refuse('rm -rf ./dist')).toBe(false);
  });
});

describe('motif rm-rf-home', () => {
  test('refuse une suppression forcée du home via tilde', () => {
    expect(refuse('rm -rf ~')).toBe(true);
    expect(refuse('rm -rf ~/')).toBe(true);
  });

  test('laisse passer un nettoyage de worktree', () => {
    expect(refuse('rm -rf node_modules')).toBe(false);
  });
});

describe('motif rm-rf-home-var', () => {
  test('refuse une suppression forcée du home via $HOME', () => {
    expect(refuse('rm -rf $HOME')).toBe(true);
    expect(refuse('rm -rf $HOME/config')).toBe(true);
  });

  test('laisse passer une simple lecture de $HOME', () => {
    expect(refuse('echo $HOME')).toBe(false);
  });
});

describe('motif rm-rf-hors-worktree', () => {
  test('refuse une suppression forcée remontant hors du worktree', () => {
    expect(refuse('rm -rf ../')).toBe(true);
    expect(refuse('rm -rf ../../secrets')).toBe(true);
  });

  test('laisse passer un nettoyage relatif interne au worktree', () => {
    expect(refuse('rm -rf node_modules')).toBe(false);
    expect(refuse('rm -rf ./build')).toBe(false);
  });
});

describe('motif sudo-rm-rf', () => {
  test('refuse toute suppression forcée privilégiée', () => {
    expect(refuse('sudo rm -rf /var/lib/data')).toBe(true);
    expect(refuse('sudo rm -rf ./whatever')).toBe(true);
  });

  test('laisse passer un sudo qui n’est pas une suppression', () => {
    expect(refuse('sudo apt-get install curl')).toBe(false);
    expect(refuse('rm -rf node_modules')).toBe(false);
  });
});

describe('motif dd-vers-peripherique', () => {
  test('refuse une écriture brute sur un périphérique bloc, avec ou sans sudo', () => {
    expect(refuse('dd if=/dev/zero of=/dev/sda')).toBe(true);
    expect(refuse('sudo dd if=/dev/zero of=/dev/sda')).toBe(true);
  });

  test('laisse passer un dd vers un fichier ordinaire', () => {
    expect(refuse('dd if=image.iso of=output.img')).toBe(false);
  });
});

describe('motif mkfs', () => {
  test('refuse un formatage de système de fichiers, avec ou sans sudo', () => {
    expect(refuse('mkfs.ext4 /dev/sdb1')).toBe(true);
    expect(refuse('sudo mkfs.ext4 /dev/sdb1')).toBe(true);
  });

  test('laisse passer une commande de build ordinaire', () => {
    expect(refuse('npm run build')).toBe(false);
  });
});

describe('motif git-push-force-long', () => {
  test('refuse un push forcé (forme longue)', () => {
    expect(refuse('git push origin main --force')).toBe(true);
  });

  test('laisse passer un push normal', () => {
    expect(refuse('git push origin main')).toBe(false);
  });
});

describe('motif git-push-force-court', () => {
  test('refuse un push forcé (alias court -f)', () => {
    expect(refuse('git push origin main -f')).toBe(true);
  });

  test('ne se déclenche pas sur un nom de branche contenant "-f" (faux positif évité)', () => {
    expect(refuse('git push origin my-feature')).toBe(false);
  });
});

describe('motif apt-get-remove', () => {
  test('refuse une désinstallation apt-get', () => {
    expect(refuse('sudo apt-get remove docker')).toBe(true);
  });

  test('laisse passer une installation apt-get', () => {
    expect(refuse('sudo apt-get install curl')).toBe(false);
  });

  test('☠ limite connue et acceptée : `apt-get purge` n’est pas couvert (hors plafond de 15)', () => {
    expect(refuse('sudo apt-get purge docker')).toBe(false);
  });
});

describe('motif pacman-remove', () => {
  test('refuse une désinstallation pacman quelles que soient les options', () => {
    expect(refuse('sudo pacman -Rns git')).toBe(true);
    expect(refuse('sudo pacman -R git')).toBe(true);
  });

  test('laisse passer une installation pacman', () => {
    expect(refuse('sudo pacman -S git')).toBe(false);
  });
});

describe('motif ecrasement-env (Write)', () => {
  test('refuse l’écrasement d’un .env, à la racine ou en profondeur', () => {
    expect(refuse('.env', 'Write')).toBe(true);
    expect(refuse('apps/api/.env', 'Write')).toBe(true);
  });

  test('laisse passer un fichier de code ou un .env.example', () => {
    expect(refuse('src/index.ts', 'Write')).toBe(false);
    expect(refuse('.env.example', 'Write')).toBe(false);
  });
});

describe('motif edition-env (Edit)', () => {
  test('refuse l’édition d’un .env existant', () => {
    expect(refuse('.env', 'Edit')).toBe(true);
    expect(refuse('config/.env', 'Edit')).toBe(true);
  });

  test('laisse passer l’édition d’un fichier de code', () => {
    expect(refuse('src/index.ts', 'Edit')).toBe(false);
  });
});

describe('motif ecrasement-ssh', () => {
  test('refuse l’écrasement de clés ou config SSH', () => {
    expect(refuse('.ssh/id_ed25519', 'Write')).toBe(true);
    expect(refuse('home/user/.ssh/authorized_keys', 'Write')).toBe(true);
  });

  test('laisse passer un fichier de code contenant "ssh" dans son nom', () => {
    expect(refuse('src/ssh-client.ts', 'Write')).toBe(false);
  });
});

describe('motif ecrasement-credentials-cc', () => {
  test('refuse l’écrasement des identifiants Claude Code', () => {
    expect(refuse('.credentials.json', 'Write')).toBe(true);
    expect(refuse('accounts/compte2/.credentials.json', 'Write')).toBe(true);
  });

  test('laisse passer un fichier de credentials d’exemple', () => {
    expect(refuse('credentials.example.json', 'Write')).toBe(false);
  });
});

describe('motif pkill-motif-generique', () => {
  // Incident réel du 2026-07-08 : `pkill -f "uvicorn app.main:app"`, lancé pour nettoyer
  // son propre déploiement, a tué un backend tiers sur le même hôte. Mort par SIGTERM
  // propre ⇒ `Restart=on-failure` ne l'a jamais relevé. Le motif borne le balayage de la
  // table des process, pas l'arrêt d'un process qu'on possède.
  test('refuse la terminaison par motif de ligne de commande', () => {
    expect(refuse('pkill -f "uvicorn app.main:app"')).toBe(true);
    expect(refuse('sudo pkill -f node')).toBe(true);
    expect(motifResponsable('pkill -f vite')).toBe('pkill-motif-generique');
  });

  test('laisse passer l’arrêt d’un process que le projet possède', () => {
    expect(refuse('./stop.sh')).toBe(false);
    expect(refuse('kill 48213')).toBe(false);
    expect(refuse('kill -TERM "$(cat logs/api.pid)"')).toBe(false);
  });
});

describe('le déni précède le mode de permission (C.1.1/C.1.2)', () => {
  test('le verdict de refus est identique en bypassPermissions — preuve du plancher, pas convention', () => {
    const cible = 'rm -rf /';
    const enAuto = simulerArbitrage(PLANCHER_DENI, { outil: 'Bash', cible }, 'auto');
    const enBypass = simulerArbitrage(PLANCHER_DENI, { outil: 'Bash', cible }, 'bypassPermissions');
    expect(enAuto.refuse).toBe(true);
    expect(enBypass.refuse).toBe(true);
    expect(enAuto.motifId).toBe(enBypass.motifId);
  });
});

describe('intégration — câblage réel dans WorkerSpec / Options (workers/, M-01)', () => {
  const MODEL: ResolvedModel = {
    requested: 'sonnet',
    resolved: 'claude-sonnet-4-6',
    tier: 'sonnet',
    viaInheritance: false,
  };

  function spec(overrides: Partial<WorkerSpec> = {}): WorkerSpec {
    return {
      sessionId: '11111111-2222-3333-4444-555555555555',
      cwd: '/tmp/worktree-alpha',
      mandate: 'Tu es team leader.',
      // Audit inactif EXPLICITEMENT sur cette doublure (H-74) : jamais une omission.
      mcpServers: {}, portAuditPermissions: () => ({}),
      deniedToolPatterns: PLANCHER_DENI_SDK,
      maxBudgetUsd: 200,
      ...overrides,
    };
  }

  test('le plancher réel se compose tel quel dans disallowedTools', () => {
    const { options } = composeWorkerOptions(spec(), MODEL);
    expect(options.disallowedTools).toEqual([...PLANCHER_DENI_SDK]);
  });

  // `☠` RENVERSEMENT ASSUMÉ de H-40/H-42 (décision Chris, 2026-07-31). Ce test
  // exigeait `auto` et interdisait le bypass, à une époque où un classifieur
  // pouvait encore escalader vers un humain. Le bus d'escalade a été retiré : un
  // refus du classifieur ne mènerait plus nulle part, l'équipe attendrait un
  // verdict que personne ne peut rendre. Le produit vise l'autonomie — Chris
  // décide à l'approbation du mandat, plus jamais action par action.
  //
  // Ce qui borne l'équipe ne dépend PAS du mode, et c'est mesuré, pas déduit :
  // `acceptation/bypass-denis-reel.ts` prouve sur un worker réel que Write/Edit
  // sont retirés de la liste d'outils et qu'une règle scopée refuse toujours.
  test('le mode de permission composé est celui de l’autonomie, avec son drapeau obligatoire', () => {
    const { options } = composeWorkerOptions(spec(), MODEL);
    expect(options.permissionMode).toBe('bypassPermissions');
    // Dépareillés, le SDK ignore le mode et le worker attend une invite que plus
    // personne ne peut lui rendre — l'invariant de composition l'interdit.
    expect(options.allowDangerouslySkipPermissions).toBe(true);
  });
});
