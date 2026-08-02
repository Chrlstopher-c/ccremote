/**
 * Responsabilité : ports du serveur MCP de contrôle (A.2) pour lesquels
 * AUCUNE implémentation réelle n'existe nulle part dans ce dépôt, et qui ne
 * peuvent pas être construits par une simple composition — voir le rapport de
 * mission, section « ce qui ne s'assemble pas ».
 *
 * `DefinisseurBudget` (`definir()`) exigerait de modifier `maxBudgetUsd` d'une
 * session déjà démarrée — AUCUNE opération `CanalControle` (D.3) ne le permet
 * aujourd'hui. Ajouter cette opération est une décision d'architecture (étendre
 * un contrat d'un autre domaine), pas un câblage — hors mandat.
 *
 * `☠` H-74, principe 2 : plutôt que de laisser cet outil MCP échouer
 * silencieusement (ou, pire, réussir sans effet), cette implémentation REFUSE
 * explicitement et journalise au niveau `warn` à chaque appel — jamais un
 * faux succès.
 *
 * `☠ CE QUI A ÉTÉ RETIRÉ D'ICI (02/08)` — `CIBLES_NON_CABLEES` vivait dans ce
 * fichier et refusait TOUT appel à `envoyer_a_equipe` / `interrompre_equipe`.
 * Le refus explicite a bien empêché le faux succès, mais sa formulation côté
 * outil (« équipe introuvable ou plus vivante ») a fait croire à l'orchestrateur
 * que ses équipes étaient mortes : il a tenté des relances sur des équipes
 * vivantes, et laissé filer des équipes qui dérapaient faute de pouvoir leur
 * parler. Leçon retenue : un refus honnête doit aussi nommer LA BONNE CAUSE.
 * Ces deux outils passent désormais par le canal de contrôle (`EmetteurEquipe`).
 */

import type { DefinisseurBudget } from '../../control-plane/orchestrateur/mcp-controle/types.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'ports-non-cables' });

export const BUDGET_NON_CABLE: DefinisseurBudget = {
  async definir(missionId: string, maxUsd: number): Promise<void> {
    log.warn(
      { missionId, maxUsd },
      "DefinisseurBudget non câblé — aucune opération CanalControle (D.3) ne permet de modifier maxBudgetUsd sur une session déjà démarrée",
    );
    throw new Error('definir_budget : aucun canal réel vers une session déjà démarrée (voir ports-non-cables.ts)');
  },
};
