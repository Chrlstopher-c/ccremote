// Responsabilité : borner les sous-agents d'une session — Sonnet imposé, pas de fork, au plus N par étape.
// Mesuré (sessions du 21 au 28/09) : un sous-agent démarre à ~21k tokens puis reconstruit sa compréhension ;
// utile pour une exploration isolée, ruineux en série.

// Sortie JSON d'un hook PreToolUse du CLI Claude Code.
export type DecisionCrochet = {
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow' | 'deny';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
  };
};

export const MAX_SOUS_AGENTS_PAR_ETAPE = 3;
const OUTILS_SOUS_AGENT = new Set(['Agent', 'Task']);

export class GardeSousAgents {
  private lances = 0;

  nouvelleEtape(): void {
    this.lances = 0;
  }

  decider(nomOutil: string, entree: unknown): DecisionCrochet {
    if (!OUTILS_SOUS_AGENT.has(nomOutil)) return {};
    const champs = typeof entree === 'object' && entree !== null ? (entree as Record<string, unknown>) : {};
    if (champs['subagent_type'] === 'fork') return refus('fork refusé : il hérite de ton modèle et de tout ton contexte.');
    if (this.lances >= MAX_SOUS_AGENTS_PAR_ETAPE) {
      return refus(`déjà ${this.lances} sous-agents dans cette étape : fais-le toi-même, ou termine l’étape d’abord.`);
    }
    this.lances += 1;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...champs, model: 'sonnet' } } };
  }
}

function refus(raison: string): DecisionCrochet {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: raison } };
}
