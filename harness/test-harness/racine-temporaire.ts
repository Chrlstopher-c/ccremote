/**
 * Responsabilité : racines de fichiers éphémères pour les tests qui valident de
 * VRAIS chemins (`validerConfigProjet` vérifie l'existence d'un répertoire, pas
 * une chaîne).
 *
 * `☠` Ces tests codaient en dur le scratchpad d'une session Claude Code —
 * `/tmp/claude-1000/-home-trinity/<uuid-de-session>/scratchpad/…` — et les
 * répertoires qu'ils validaient (`depot-git/`, `repo-alpha/`…) avaient été créés
 * À LA MAIN dans cette session-là. La session terminée, le scratchpad a disparu
 * et 31 tests sont passés au rouge d'un coup, sans qu'une seule ligne de code
 * produit ait changé. Ils y sont restés, et ce bloc rouge permanent masquait
 * tout nouvel échec réel : c'est le vrai coût, pas les tests eux-mêmes.
 *
 * La règle qui en découle : un test crée ce qu'il valide. Il ne dépend jamais
 * d'un état préparé hors de lui, et surtout pas d'un répertoire dont la durée de
 * vie est celle d'une conversation.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface RacineTemporaire {
  readonly racine: string;
  /** Crée un sous-répertoire et rend son chemin absolu. */
  sousRepertoire(nom: string): string;
  /** Crée un fichier (contenu vide par défaut) et rend son chemin absolu. */
  fichier(nom: string, contenu?: string): string;
  /** Supprime toute la racine. À appeler en `afterAll`. */
  nettoyer(): void;
}

/**
 * Crée une racine unique sous le répertoire temporaire du système. Unique par
 * appel : deux fichiers de test qui tournent en parallèle ne se marchent jamais
 * dessus, contrairement à un chemin fixe partagé.
 */
export function creerRacineTemporaire(prefixe = 'ccremote-test-'): RacineTemporaire {
  const racine = mkdtempSync(join(tmpdir(), prefixe));
  return {
    racine,
    sousRepertoire(nom: string): string {
      const chemin = join(racine, nom);
      mkdirSync(chemin, { recursive: true });
      return chemin;
    },
    fichier(nom: string, contenu = ''): string {
      const chemin = join(racine, nom);
      writeFileSync(chemin, contenu, 'utf-8');
      return chemin;
    },
    nettoyer(): void {
      rmSync(racine, { recursive: true, force: true });
    },
  };
}
