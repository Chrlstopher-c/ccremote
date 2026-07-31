/**
 * Responsabilité : ports du serveur MCP de contrôle (A.2) pour lesquels
 * AUCUNE implémentation réelle n'existe nulle part dans ce dépôt, et qui ne
 * peuvent pas être construits par une simple composition — voir le rapport de
 * mission, section « ce qui ne s'assemble pas ».
 *
 * `RepertoireCibles` (`cible()`) exigerait un canal D.1 par worker (le canal
 * de données d'une session, pas le canal de contrôle D.3) — hors périmètre
 * mécanique de cette mission (transport par worker, pas encore composé).
 * `DefinisseurBudget` (`definir()`) exigerait de modifier `maxBudgetUsd` d'une
 * session déjà démarrée — AUCUNE opération `CanalControle` (D.3) ne le permet
 * aujourd'hui (`OperationControle` n'a que six variantes, aucune ne touche au
 * budget). Ajouter cette opération est une décision d'architecture (étendre
 * un contrat d'un autre domaine), pas un câblage — hors mandat.
 *
 * `☠` H-74, principe 2 : plutôt que de laisser ces deux outils MCP échouer
 * silencieusement (ou, pire, réussir sans effet), ces implémentations REFUSENT
 * explicitement et journalisent au niveau `warn` à chaque appel — jamais un
 * faux succès.
 */

import type {
  CibleEquipe,
  DefinisseurBudget,
  RepertoireCibles,
} from '../../control-plane/orchestrateur/mcp-controle/types.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'ports-non-cables' });

export const CIBLES_NON_CABLEES: RepertoireCibles = {
  cible(missionId: string): CibleEquipe | null {
    log.warn({ missionId }, "RepertoireCibles non câblé — nécessite un canal D.1 par worker, non composé par cette mission");
    return null;
  },
};

export const BUDGET_NON_CABLE: DefinisseurBudget = {
  async definir(missionId: string, maxUsd: number): Promise<void> {
    log.warn(
      { missionId, maxUsd },
      "DefinisseurBudget non câblé — aucune opération CanalControle (D.3) ne permet de modifier maxBudgetUsd sur une session déjà démarrée",
    );
    throw new Error('definir_budget : aucun canal réel vers une session déjà démarrée (voir ports-non-cables.ts)');
  },
};
