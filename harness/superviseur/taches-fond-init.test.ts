/**
 * `☠` LA panne du 02/08, mesurée sur la mission ab7183f0 — 7,72 $ de travail
 * perdu, et deux autres équipes tombées le même jour.
 *
 * Le lead lance quatre sous-agents en ARRIÈRE-PLAN et rend la main. Le harness
 * sait déjà ne pas conclure sur ce `result`-là : `background_tasks_changed`
 * porte quatre tâches, la garde tient (16:34:14, journal du VPS). Le premier
 * sous-agent notifie sa fin à 16:37:48 — et là le SDK émet un `init`, que le
 * collecteur prenait pour un redémarrage de process : il vidait la liste. Le
 * `result` suivant, trois secondes plus tard, passait pour une fin de mission.
 * Les trois derniers sous-agents ont rendu leur travail deux secondes après,
 * dans une session déjà close.
 *
 * `init` de reprise de tour VS `init` de process neuf : mesuré sur banc réel
 * (`acceptation/taches-fond-sousagents-reel.ts`, 02/08) — le SDK en émet à
 * chaque reprise, notamment après une notification de tâche de fond et après un
 * `result`. Ce n'est donc pas un signal de démarrage, et il ne peut pas servir à
 * remettre quoi que ce soit à zéro.
 *
 * Ces tests portent sur les deux propriétés qui coûtaient des équipes :
 *  1. un `init` en cours de session ne fait pas disparaître les tâches vivantes ;
 *  2. tant qu'une tâche vit, l'équipe n'est pas « au repos » — sans quoi le Pi
 *     notifie une fin de tour, l'affiche au repos, et la clôture automatique la
 *     ferme quinze minutes plus tard, en plein travail.
 */

import { describe, expect, test } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { CollecteurTelemetrie } from './collecteur-telemetrie.ts';

function collecteur(): CollecteurTelemetrie {
  const c = new CollecteurTelemetrie();
  c.ouvrir('m-1', 's-1', 0);
  return c;
}

function tachesDeFond(nombre: number): SDKMessage {
  return {
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: Array.from({ length: nombre }, (_, i) => ({
      task_id: `t-${i}`,
      task_type: 'subagent',
      description: `recherche n°${i}`,
    })),
    uuid: 'u',
    session_id: 's-1',
  } as unknown as SDKMessage;
}

/** Le message émis à chaque REPRISE de tour — pas au démarrage du process. */
function initReprise(): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    model: 'claude-opus-4-6',
    uuid: 'u',
    session_id: 's-1',
  } as unknown as SDKMessage;
}

function resultOk(): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 1,
    result: 'ok',
    total_cost_usd: 0.5,
    terminal_reason: 'completed',
    uuid: 'u',
    session_id: 's-1',
  } as unknown as SDKMessage;
}

function messageAssistant(): SDKMessage {
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text: "J'attends les trois autres." }] },
    uuid: 'u',
    session_id: 's-1',
  } as unknown as SDKMessage;
}

function etatSdk(c: CollecteurTelemetrie): string | null {
  return c.tous().find((t) => t.missionId === 'm-1')?.etatSdk ?? null;
}

describe('un `init` de reprise de tour n’efface pas les tâches de fond', () => {
  test('☠ la séquence EXACTE de la mission ab7183f0 : quatre agents, notification, init, result', () => {
    const c = collecteur();
    c.ingerer('m-1', tachesDeFond(4));
    c.ingerer('m-1', resultOk()); // result n°1 — la garde tenait déjà avant le correctif
    expect(c.aDesTachesFond('m-1')).toBe(true);

    // Le premier sous-agent rend son travail : le SDK réémet le niveau (3
    // restants) puis rouvre un tour. C'est cet `init` qui vidait tout.
    c.ingerer('m-1', tachesDeFond(3));
    c.ingerer('m-1', initReprise());
    c.ingerer('m-1', messageAssistant());
    c.ingerer('m-1', resultOk()); // result n°2 — celui qui a tué l'équipe

    expect(c.aDesTachesFond('m-1')).toBe(true);
  });

  test('le modèle résolu continue d’être lu sur l’`init`', () => {
    const c = collecteur();
    c.ingerer('m-1', initReprise());
    expect(c.tous().find((t) => t.missionId === 'm-1')?.modeleResolu).toBe('claude-opus-4-6');
  });

  test('la dernière tâche qui s’éteint rend bien la mission finie', () => {
    const c = collecteur();
    c.ingerer('m-1', tachesDeFond(2));
    c.ingerer('m-1', initReprise());
    c.ingerer('m-1', tachesDeFond(0));
    expect(c.aDesTachesFond('m-1')).toBe(false);
  });

  test('☠ un process relancé n’hérite pas des tâches du précédent', () => {
    // Sans `reinitialiserTachesFond`, retirer la remise à zéro de l'`init`
    // rendrait un worker relancé immortel : ses tâches ne s'éteindraient jamais,
    // et son projet resterait verrouillé (H-56).
    const c = collecteur();
    c.ingerer('m-1', tachesDeFond(4));
    c.reinitialiserTachesFond('m-1');
    expect(c.aDesTachesFond('m-1')).toBe(false);
  });
});

describe('☠ une tâche de fond qui ne s’éteint jamais ne rend pas l’équipe immortelle', () => {
  // Le cas réel : le lead lance `bun run dev` en arrière-plan pour tester, puis
  // termine. Cette tâche-là ne s'éteindra pas. Sans borne, l'équipe ne serait
  // plus jamais déclarée finie NI close automatiquement (celle-ci exige `idle`),
  // et son projet resterait verrouillé à vie — la panne d'aujourd'hui inversée.
  const VINGT_ET_UNE_MIN = 21 * 60_000;

  test('avant la borne, l’attente est respectée', () => {
    const c = collecteur();
    c.ingerer('m-1', tachesDeFond(1), 0);
    c.ingerer('m-1', resultOk(), 0);
    expect(c.aDesTachesFond('m-1', 10 * 60_000)).toBe(true);
    expect(c.tous(10 * 60_000).find((t) => t.missionId === 'm-1')?.etatSdk).toBe('running');
  });

  test('passé la borne, l’équipe redevient close-able', () => {
    const c = collecteur();
    c.ingerer('m-1', tachesDeFond(1), 0);
    c.ingerer('m-1', resultOk(), 0);
    expect(c.aDesTachesFond('m-1', VINGT_ET_UNE_MIN)).toBe(false);
    expect(c.tous(VINGT_ET_UNE_MIN).find((t) => t.missionId === 'm-1')?.etatSdk).toBe('idle');
  });

  test('chaque annonce de tâches vivantes relance la patience', () => {
    const c = collecteur();
    c.ingerer('m-1', tachesDeFond(2), 0);
    c.ingerer('m-1', resultOk(), 0);
    // Un sous-agent finit au bout de 15 min : le SDK réémet l'ensemble restant.
    c.ingerer('m-1', tachesDeFond(1), 15 * 60_000);
    // 21 min après le DÉPART, mais 6 min seulement après la dernière preuve de vie.
    expect(c.aDesTachesFond('m-1', VINGT_ET_UNE_MIN)).toBe(true);
  });
});

describe('« tour rendu » et « au repos » sont deux choses distinctes', () => {
  test('☠ un lead qui attend ses sous-agents n’est PAS au repos', () => {
    // `idle` déclenche trois choses côté Pi : la notification de fin de tour à
    // l'orchestrateur, l'affichage « au repos », et la clôture automatique à
    // quinze minutes. Les trois étaient fausses ici.
    const c = collecteur();
    c.ingerer('m-1', tachesDeFond(3));
    c.ingerer('m-1', resultOk());
    expect(etatSdk(c)).toBe('running');
  });

  test('la dernière tâche éteinte APRÈS le result fait basculer au repos', () => {
    const c = collecteur();
    c.ingerer('m-1', tachesDeFond(1));
    c.ingerer('m-1', resultOk());
    expect(etatSdk(c)).toBe('running');
    c.ingerer('m-1', tachesDeFond(0));
    expect(etatSdk(c)).toBe('idle');
  });

  test('sans aucune tâche de fond, un result vaut repos — comportement d’avant inchangé', () => {
    const c = collecteur();
    c.ingerer('m-1', resultOk());
    expect(etatSdk(c)).toBe('idle');
  });

  test('le lead qui reprend la parole repasse en travail', () => {
    const c = collecteur();
    c.ingerer('m-1', resultOk());
    expect(etatSdk(c)).toBe('idle');
    c.ingerer('m-1', messageAssistant());
    expect(etatSdk(c)).toBe('running');
  });
});
