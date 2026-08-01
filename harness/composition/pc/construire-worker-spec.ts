/**
 * Responsabilité : construire un `WorkerSpec` (`workers/types.ts`) qui n'omet
 * JAMAIS le port d'audit (H-74). Le type d'origine ne peut pas l'imposer seul —
 * `workers/` ne doit rien savoir de `control-plane/` (frontière de domaine) —
 * mais rien n'empêchait un appelant de composition de l'oublier. Cette fonction
 * est le point unique où un `WorkerSpec` de production est construit : elle rend
 * l'oubli impossible en exigeant le port en paramètre, jamais en option.
 */

import type { WorkerSpec } from '../../workers/index.ts';
import type { PortAuditPermissions } from '../../workers/types.ts';
import { resoudreMcpEquipe } from '../../workers/mcp-du-poste.ts';
import { superviseurLogger } from '../../superviseur/logger.ts';

export interface ParametresWorkerSpec {
  readonly sessionId: string;
  readonly cwd: string;
  readonly mandate: string;
  readonly deniedToolPatterns: readonly string[];
  readonly maxBudgetUsd: number;
  readonly model?: string;
  readonly effortLevel?: 'low' | 'medium' | 'high' | 'xhigh';
  readonly configDir?: string;
  readonly compteId?: string;
  readonly agentTeams?: boolean;
  readonly extraEnv?: Readonly<Record<string, string>>;
}

/**
 * Comptes Claude connus de CETTE machine — `id` ⇒ répertoire local.
 * `☠` C'est la moitié « poste » de H-44 : le Pi transporte une identité, la
 * machine seule sait où elle vit chez elle.
 */
export type ComptesDuPoste = readonly { readonly id: string; readonly configDir: string }[];

export function construireWorkerSpec(
  parametres: ParametresWorkerSpec,
  portAuditPermissions: PortAuditPermissions,
  comptesDuPoste: ComptesDuPoste = [],
): WorkerSpec {
  // ☠ Les serveurs MCP sont résolus ICI, au point unique d'assemblage, pour la
  // même raison que le port d'audit : le type peut exiger le champ, il ne peut
  // pas empêcher un appelant de passer `{}`. Résolus à la source du poste, ils
  // ne peuvent plus être « oubliés » — et l'absence est DITE, jamais subie.
  const mcp = resoudreMcpEquipe();
  if (mcp.manquants.length > 0) {
    // ☠ `warn` et non `debug` : c'est exactement le signal qui a manqué pendant
    // toute la vie du harness. Une équipe démarre quand même — elle travaillera
    // au shell — mais plus jamais en silence.
    superviseurLogger.warn(
      { manquants: mcp.manquants, source: mcp.source, presents: Object.keys(mcp.serveurs) },
      'serveurs MCP absents du poste — l’équipe démarre sans eux, ses validations E2E seront dégradées',
    );
  } else {
    superviseurLogger.info({ mcp: Object.keys(mcp.serveurs) }, 'serveurs MCP transmis à l’équipe');
  }
  // ☠ H-44 RENDUE EFFECTIVE. Le `configDir` reçu du Pi est le chemin d'UNE
  // machine ; depuis le multi-machines il peut ne pas exister ici. Mesuré en
  // réel le 01/08 : un mandat routé vers le VPS portait
  // `/home/trinity/.claude-comptes/compte-a` et le pré-vol refusait de spawner
  // (`machine_claude_md_missing`) — la panne était bruyante, mais elle rendait
  // le VPS structurellement incapable de lancer une équipe.
  //
  // ☠ Compte INCONNU d'ici ⇒ on garde ce que le Pi a dit, et on le DIT. Inventer
  // un chemin serait pire ; se taire laisserait le pré-vol échouer sans que
  // personne relie la cause à l'effet.
  const local = comptesDuPoste.find((c) => c.id === parametres.compteId);
  if (local !== undefined && local.configDir !== parametres.configDir) {
    superviseurLogger.info(
      { compteId: parametres.compteId, recu: parametres.configDir, local: local.configDir },
      'répertoire de compte réécrit avec celui de cette machine (H-44)',
    );
  } else if (local === undefined && parametres.compteId !== undefined) {
    superviseurLogger.warn(
      { compteId: parametres.compteId, configDir: parametres.configDir },
      'compte inconnu de cette machine — le chemin du Pi est conservé tel quel ; le pré-vol échouera s’il n’existe pas ici',
    );
  }
  const configDir = local?.configDir ?? parametres.configDir;

  // ☠ Le port d'audit est un paramètre OBLIGATOIRE, jamais un champ optionnel
  // de `parametres` (H-74) : un worker assemblé sans audit passerait tous les
  // tests en n'observant rien.
  return { ...parametres, configDir, mcpServers: mcp.serveurs, portAuditPermissions };
}
