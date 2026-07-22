/**
 * Responsabilité : implémentation RÉELLE du port `JugeBoucle` (H-68), appelant le SDK
 * en Haiku. Mission M-53.
 *
 * `☠ Règle d'architecture non négociable` (H-68) — l'appel réel au SDK vit STRICTEMENT
 * ici. Aucun autre fichier de ce dossier n'importe `query` du SDK. C'est ce qui garantit
 * qu'injecter une doublure de `JugeBoucle` dans du code appelant (superviseur, tests)
 * ne déclenche jamais un vrai appel réseau — piège déjà payé sur `vitrail-project`
 * (mémoire `feedback`) où l'appel réel vivait dans l'appelant plutôt que dans
 * l'implémentation du backend, cassant l'isolation des tests.
 *
 * `⚠ HYP` — la fiabilité du juge n'est PAS démontrée par les tests de ce fichier (ils
 * injectent une doublure de `AntiBoucleQueryFn`, jamais un vrai réseau). Voir le rapport
 * de mission pour le banc réel qui manque encore.
 */

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { antiBoucleLogger } from './logger.ts';
import type { AntiBoucleQueryFn, ContexteJugement, JugeBoucle, SignauxBoucle, Verdict, VerdictJuge } from './types.ts';

/** Modèle imposé par la spécification H-68 : coût négligeable, appelé seulement aux paliers. */
export const MODELE_JUGE_PAR_DEFAUT = 'claude-haiku-4-5-20251001';

/** Au-delà, on considère que Haiku ne répondra pas — le juge doit rester bon marché ET rapide. */
const TIMEOUT_JUGEMENT_MS_DEFAUT = 30_000;

const VERDICTS_VALIDES: readonly Verdict[] = ['boucle', 'progres', 'incertain'];

const SCHEMA_VERDICT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: VERDICTS_VALIDES },
    motif: { type: 'string' },
  },
  required: ['verdict', 'motif'],
  additionalProperties: false,
} as const;

export interface DependancesJugeHaiku {
  readonly query?: AntiBoucleQueryFn;
  readonly model?: string;
  readonly timeoutMs?: number;
}

/**
 * Verdict de repli sur toute panne de plomberie (réseau, parsing, timeout). `☠` Ne
 * jamais rendre `boucle` sur erreur : une panne du juge lui-même n'est pas une preuve
 * de boucle, et le biais asymétrique de H-68 s'applique aussi aux échecs du juge.
 */
function verdictDeRepli(motif: string): VerdictJuge {
  return { verdict: 'incertain', motif };
}

function construirePrompt(signaux: SignauxBoucle, contexte: ContexteJugement): string {
  return [
    "Tu es un juge anti-boucle pour un harness d'agents Claude Code autonomes (H-68).",
    `Palier de déclenchement : ${String(contexte.palierUsd)} $ — coût courant estimé : ${String(contexte.coutCourantUsd)} $.`,
    "Tu ne vois PAS le transcript complet, seulement des signaux agrégés sur les derniers tours :",
    JSON.stringify(signaux, null, 2),
    '',
    'Signaux de boucle à considérer explicitement : mêmes outils sur les mêmes cibles répétés, ' +
      'même erreur répétée, aucun fichier modifié depuis plusieurs tours, tests échouant à ' +
      "l'identique, réécriture alternée des mêmes lignes.",
    '',
    'Réponds « boucle » seulement si tu es CONFIANT que la mission ne progresse plus. ' +
      'Réponds « progres » seulement si tu es CONFIANT qu\'elle avance réellement. ' +
      "Dans TOUS les autres cas, réponds « incertain » — un faux « boucle » détruit du " +
      'travail légitime en silence, c\'est la pire erreur possible ici. Motif court, une phrase.',
  ].join('\n');
}

function extraireTexteResultat(message: SDKMessage): string | null {
  if (message.type !== 'result' || message.subtype !== 'success') return null;
  if (message.structured_output !== undefined) return JSON.stringify(message.structured_output);
  return message.result;
}

function parserVerdict(texte: string): VerdictJuge {
  const brut: unknown = JSON.parse(texte);
  if (typeof brut !== 'object' || brut === null) throw new Error('sortie du juge non-objet');
  const objet = brut as Record<string, unknown>;
  const verdict = objet['verdict'];
  const motif = objet['motif'];
  if (typeof verdict !== 'string' || !VERDICTS_VALIDES.includes(verdict as Verdict)) {
    throw new Error(`verdict invalide reçu du juge : ${JSON.stringify(verdict)}`);
  }
  if (typeof motif !== 'string') throw new Error('motif absent ou non-texte dans la sortie du juge');
  return { verdict: verdict as Verdict, motif };
}

/**
 * Crée l'implémentation réelle du port `JugeBoucle`. Un appel = une requête one-shot
 * (`maxTurns: 1`, aucun outil) sur Haiku, structurée via `outputFormat: json_schema`.
 */
export function creerJugeHaiku(deps: DependancesJugeHaiku = {}): JugeBoucle {
  const executerQuery = deps.query ?? ((params) => sdkQuery(params));
  const model = deps.model ?? MODELE_JUGE_PAR_DEFAUT;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_JUGEMENT_MS_DEFAUT;

  return {
    async juger(signaux: SignauxBoucle, contexte: ContexteJugement): Promise<VerdictJuge> {
      const log = antiBoucleLogger.child({ missionId: contexte.missionId, palierUsd: contexte.palierUsd });
      try {
        const stream = executerQuery({
          prompt: construirePrompt(signaux, contexte),
          options: {
            model,
            maxTurns: 1,
            tools: [],
            permissionMode: 'default',
            outputFormat: { type: 'json_schema', schema: SCHEMA_VERDICT },
          },
        });

        const resultat = await Promise.race([
          attendreResultat(stream),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
        ]);

        if (resultat === 'timeout') {
          log.warn('juge Haiku : timeout — repli sur incertain (H-68)');
          return verdictDeRepli(`timeout après ${String(timeoutMs)} ms — aucun verdict fiable`);
        }
        if (resultat === null) {
          log.warn('juge Haiku : aucun message result reçu — repli sur incertain (H-68)');
          return verdictDeRepli('flux terminé sans message result exploitable');
        }

        const verdict = parserVerdict(resultat);
        log.info({ verdict: verdict.verdict }, 'juge Haiku : verdict rendu');
        return verdict;
      } catch (erreur) {
        log.error({ err: erreur }, 'juge Haiku en échec — repli sur incertain (H-68, biais asymétrique)');
        return verdictDeRepli(`erreur du juge : ${String(erreur)} — repli de sûreté sur incertain`);
      }
    },
  };
}

async function attendreResultat(stream: ReturnType<AntiBoucleQueryFn>): Promise<string | null> {
  for await (const message of stream) {
    const texte = extraireTexteResultat(message);
    if (texte !== null) return texte;
    if (message.type === 'result') {
      // `error_*` : pas de texte structuré exploitable, mais le flux se termine ici.
      return null;
    }
  }
  return null;
}
