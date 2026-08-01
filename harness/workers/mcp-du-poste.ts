/**
 * Responsabilité : donner à une équipe les serveurs MCP du poste — lus à la
 * source, transmis EXPLICITEMENT au worker.
 *
 * `☠` Onzième occurrence du motif « écrit, testé, branché sur rien », et la plus
 * coûteuse mesurée à ce jour. Le mandat système ordonne au lead : « Utilise les
 * MCP à disposition (Playwright, Log Watcher, pty-mcp…) pour valider réellement ».
 * Relevé le 01/08 dans `~/.claude-comptes/compte-a/.claude.json` :
 * `mcpServers: []`, et aucun MCP sur aucun des quatre projets. **Les équipes
 * n'en ont jamais eu un seul.**
 *
 * `☠` La cause est un chemin incapable d'appliquer l'intention — pas un oubli.
 * `options-composition.ts` posait, à raison, que les MCP « appartiennent au PC »
 * et arrivent par `settingSources`. Mais `settingSources` charge `settings.json`,
 * alors que les serveurs MCP vivent dans `.claude.json` — un fichier que
 * `CLAUDE_CONFIG_DIR` remplace justement par celui du compte isolé, lequel est
 * vide. La règle était bonne, sa voie de transmission n'existait pas. C'est le
 * même motif que le correctif d'effort du 31/07 : un réglage qu'on croit posé et
 * qui n'atteint jamais son point de consommation.
 *
 * `☠` Conséquence de coût, pas seulement de confort : un lead sommé de valider
 * en E2E sans navigateur ni indexeur y arrive quand même — au shell, en
 * tâtonnant, sur beaucoup plus de tours. Les tours sont ce qu'on paie.
 *
 * Le poste reste la SOURCE (H-44) : on ne recopie aucune configuration ici, on
 * lit la sienne. Ce qui change, c'est que la transmission est désormais écrite.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

/**
 * Ce qu'une équipe reçoit, et rien d'autre.
 *
 * `☠` Liste NOMMÉE, jamais « tout ce que le poste déclare ». Deux raisons, et
 * les deux comptent :
 *
 * - `discord-control` écrit vers l'extérieur (messages, vocal). Une équipe
 *   autonome, la nuit, ne doit pas pouvoir parler au monde au nom de Chris ;
 * - `bug-bounty` est un outil offensif dont l'usage suppose un engagement actif
 *   vérifié par un humain. Il n'a rien à faire dans la boîte à outils par défaut
 *   d'une équipe de développement.
 *
 * `echohub` est écarté pour une raison différente et moins grave : l'inférence
 * locale mobilise la VRAM de la machine, que le harness ne réserve pas. À
 * rouvrir si une équipe en a un jour l'usage explicite.
 */
export const MCP_EQUIPE: readonly string[] = ['semantic-memory', 'codeindex', 'playwright', 'log-watcher', 'pty-mcp'];

/** Où le poste déclare ses serveurs. Injectable pour les tests. */
export function cheminConfigPoste(): string {
  return join(homedir(), '.claude.json');
}

export interface ResolutionMcp {
  readonly serveurs: Record<string, McpServerConfig>;
  /** Ceux qui étaient attendus et que le poste ne déclare pas. */
  readonly manquants: readonly string[];
  readonly source: string;
}

/**
 * Lit les serveurs MCP du poste et ne garde que ceux destinés aux équipes.
 *
 * `☠` Ne lève JAMAIS. Un poste sans `.claude.json` lisible est un cas réel
 * (première installation, config déplacée) et ce n'est pas une raison de refuser
 * de démarrer une équipe — elle travaillerait moins bien, pas faux. Mais le
 * résultat DIT ce qui manque : c'est ce que l'extinction silencieuse d'origine
 * n'a jamais fait, et c'est précisément ce qui l'a rendue invisible neuf jours.
 */
export function resoudreMcpEquipe(chemin: string = cheminConfigPoste()): ResolutionMcp {
  let declares: Record<string, McpServerConfig> = {};
  try {
    const brut: unknown = JSON.parse(readFileSync(chemin, 'utf8'));
    if (brut !== null && typeof brut === 'object' && 'mcpServers' in brut) {
      const m = (brut as { mcpServers?: unknown }).mcpServers;
      if (m !== null && typeof m === 'object' && !Array.isArray(m)) {
        declares = m as Record<string, McpServerConfig>;
      }
    }
  } catch {
    // Poste illisible : `manquants` portera la totalité de la liste attendue.
  }
  const serveurs: Record<string, McpServerConfig> = {};
  const manquants: string[] = [];
  for (const nom of MCP_EQUIPE) {
    const config = declares[nom];
    if (config === undefined) manquants.push(nom);
    else serveurs[nom] = config;
  }
  return { serveurs, manquants, source: chemin };
}
