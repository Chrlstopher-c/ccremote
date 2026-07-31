/**
 * Responsabilité : le rappel `canUseTool` fourni à tout worker.
 *
 * `☠` Ce rappel n'arbitre RIEN et n'est jamais appelé en régime normal. En
 * `permissionMode: 'auto'` — le seul mode que ce harness utilise — le
 * classifieur du lead tranche seul (H-40, H-64) et le SDK n'invoque pas ce
 * rappel. Mesuré le 2026-07-22, reconfirmé le 2026-07-31.
 *
 * Pourquoi il subsiste malgré tout : `processControlRequest` lève
 * `"canUseTool callback is not provided."` s'il doit redélivrer une demande en
 * attente et que le champ est absent. Ce chemin est aujourd'hui inatteignable
 * (plus aucun producteur de demandes depuis le retrait du bus d'escalade), mais
 * un rappel de quinze lignes coûte moins cher qu'un worker cassé par une
 * exception venue du SDK après une reconnexion.
 *
 * `☠` Fail-closed. Il refuse, toujours : accorder exécuterait une action
 * qu'aucun arbitre — ni le classifieur, ni un humain — n'a validée. Le refus
 * porte un message actionnable, de sorte que le lead reparte sur une autre voie
 * au lieu de rester bloqué (le SDK documente lui-même le blocage indéfini comme
 * le pire cas). La protection réelle vit ailleurs, en amont : plancher de déni
 * inconditionnel et accès du mandat (`shared/acces-mandat.ts`), tous deux posés
 * en `disallowedTools`, qui refusent sans jamais passer par ici.
 */

import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { sessionLogger } from './logger.ts';
import type { WorkerSpec } from './types.ts';

type CanUseTool = NonNullable<Options['canUseTool']>;

const MESSAGE_REFUS =
  'demande de permission hors du chemin nominal : aucun arbitre n’est câblé pour y répondre. ' +
  'Poursuis autrement — les outils réellement autorisés pour ce mandat sont déjà appliqués.';

export function buildCanUseTool(spec: WorkerSpec): CanUseTool {
  const log = sessionLogger(spec.sessionId).child({ composant: 'can-use-tool' });
  return async (nomOutil, _entree, _options) => {
    // Journalisé en `warn` : si cette ligne apparaît un jour, une hypothèse de
    // ce harness est fausse et cela doit se voir, pas se deviner.
    log.warn({ outil: nomOutil }, 'canUseTool invoqué — chemin réputé inatteignable, refus par défaut');
    return { behavior: 'deny', message: MESSAGE_REFUS, interrupt: false };
  };
}
