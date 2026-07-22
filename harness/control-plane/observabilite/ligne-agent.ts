/**
 * Responsabilité : la vue « clic sur un sous-agent actif » (H-72.1, point 3 —
 * « même niveau de détail que le lead »). Ne réimplémente PAS l'introspection
 * native (E.2.2) : s'appuie sur `listSubagents`/`getSubagentMessages` du SDK
 * (ou l'équivalent `SessionStore.listSubkeys`/`load`, via le port
 * `LecteurSousAgents` injecté par l'appelant — jamais un import direct du
 * `SessionStore` complet ici, scope_guard).
 *
 * Nidification profonde (sous-agent de sous-agent) reconstruite via
 * `SessionMessage.parent_agent_id` — champ absent du flux live (voir
 * `types.ts`), disponible uniquement sur les messages chargés depuis le
 * store/disque. C'est la moitié de l'arbre que le flux ne peut jamais donner.
 */

import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { observabiliteLogger as journal } from './logger.ts';
import type { LecteurSousAgents, NoeudAgentProfond } from './types.ts';

export class ErreurLigneAgent extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurLigneAgent';
  }
}

/**
 * Charge l'intégralité de la ligne de travail d'UN sous-agent, avec ses
 * propres sous-agents imbriqués (H-72.1 : « ses messages du début à la fin,
 * ce qu'il fait à l'instant »). Best-effort volontairement absent ici : le
 * store est l'autorité disque (H.3.1), une erreur remonte plutôt que de
 * rendre une vue tronquée sans le dire.
 */
export async function chargerLigneAgent(
  lecteur: LecteurSousAgents,
  sessionId: string,
  agentId: string,
): Promise<NoeudAgentProfond> {
  try {
    const messages = await lecteur.chargerMessagesAgent(sessionId, agentId);
    const enfants = await chargerEnfants(lecteur, sessionId, agentId);
    return { agentId, parentAgentId: parentAgentIdDe(messages), messages, enfants };
  } catch (erreur) {
    journal.error({ erreur, sessionId, agentId }, 'chargement_ligne_agent_echoue');
    throw new ErreurLigneAgent(`impossible de charger le sous-agent ${agentId} (session ${sessionId})`);
  }
}

/** Vue « liste » de tous les sous-agents connus (pour peupler les onglets cliquables, H-72.1). */
export async function listerSousAgentsConnus(
  lecteur: LecteurSousAgents,
  sessionId: string,
): Promise<readonly string[]> {
  try {
    return await lecteur.listerSousAgents(sessionId);
  } catch (erreur) {
    journal.error({ erreur, sessionId }, 'listage_sous_agents_echoue');
    return [];
  }
}

function parentAgentIdDe(messages: readonly SessionMessage[]): string | null {
  const premier = messages.find((m) => m.parent_agent_id !== null);
  return premier?.parent_agent_id ?? null;
}

/**
 * Un sous-agent imbriqué se découvre en pratique via `listSubagents` (qui
 * énumère TOUS les sous-chemins de la session, pas seulement les enfants
 * directs) — on ne filtre donc les enfants qu'après coup, par correspondance
 * `parent_agent_id === agentId`. `⚠ HYP` : suppose que chaque sous-agent
 * imbriqué référence son parent direct dans SES PROPRES messages, conforme à
 * la doc `SessionMessage.parent_agent_id` (E.2.2). Récursif : un enfant peut
 * lui-même avoir des enfants (nidification à N niveaux).
 */
async function chargerEnfants(
  lecteur: LecteurSousAgents,
  sessionId: string,
  agentId: string,
): Promise<readonly NoeudAgentProfond[]> {
  const tousLesIds = await lecteur.listerSousAgents(sessionId);
  const enfants: NoeudAgentProfond[] = [];
  for (const idCandidat of tousLesIds) {
    if (idCandidat === agentId) continue;
    const messagesCandidat = await lecteur.chargerMessagesAgent(sessionId, idCandidat);
    if (parentAgentIdDe(messagesCandidat) !== agentId) continue;
    const petitsEnfants = await chargerEnfants(lecteur, sessionId, idCandidat);
    enfants.push({ agentId: idCandidat, parentAgentId: agentId, messages: messagesCandidat, enfants: petitsEnfants });
  }
  return enfants;
}
