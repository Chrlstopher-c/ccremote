/**
 * Responsabilité : retenir, côté PC, ce que le flux SDK d'un worker apprend et
 * que le Pi ne peut pas deviner — modèle réellement résolu, état, coût cumulé,
 * usage de contexte, dernière activité.
 *
 * `☠` Le PC fait autorité sur ces valeurs (B.1.4) : elles n'existent que dans le
 * flux, et le flux n'existe qu'ici. Avant ce collecteur, l'interface affichait
 * « (non résolu) », un coût à 0 et un contexte à 0 sur des équipes qui
 * travaillaient réellement.
 *
 * `☠` Ne lève JAMAIS : alimenté depuis la boucle de lecture d'un worker. Une
 * exception ici arrêterait la surveillance de la mission — le prix d'un chiffre
 * d'affichage ne peut pas être la perte du pilotage.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { PosteContexte, TelemetrieWorker } from './types.ts';
import { superviseurLogger } from './logger.ts';

const log = superviseurLogger.child({ composant: 'collecteur-telemetrie' });

/** Longueur retenue de la dernière activité — un aperçu, jamais un transcript (H-45). */
const APERCU_MAX = 240;

interface Etat {
  sessionId: string;
  vivant: boolean;
  modeleResolu: string | null;
  etatSdk: TelemetrieWorker['etatSdk'];
  coutUsd: number;
  contexteTokensUtilises: number | null;
  contexteTokensMax: number | null;
  contexteVentilation: readonly PosteContexte[] | null;
  derniereActivite: string | null;
  quotaSature: boolean;
  motifQuota: string | null;
  observeA: number;
}

/**
 * `☠` Motifs de saturation observés en RÉEL (23/07) : le CLI annonce la limite
 * en clair dans un message système, et le worker enchaîne ensuite des
 * `api_error` sans jamais produire de `result`. Sans cette détection, le harness
 * relance indéfiniment sur un compte qui ne répondra plus — c'est ce qui a fait
 * passer une équipe entière pour « en cours » sans une seule réponse.
 */
const MOTIFS_SATURATION: readonly RegExp[] = [
  /spend limit/i,
  /usage limit/i,
  /rate limit/i,
  /quota exceeded/i,
  /limite de d[ée]pense/i,
];

function texteAssistant(message: SDKMessage): string | null {
  if (message.type !== 'assistant') return null;
  const contenu = (message as { message?: { content?: unknown } }).message?.content;
  if (!Array.isArray(contenu)) return null;
  const morceaux = (contenu as { type?: string; text?: string }[])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string);
  const texte = morceaux.join('').trim();
  return texte.length === 0 ? null : texte.slice(0, APERCU_MAX);
}

export class CollecteurTelemetrie {
  readonly #par = new Map<string, Etat>();

  /** Déclare un worker dès son démarrage : il apparaît avant son premier message. */
  ouvrir(missionId: string, sessionId: string, maintenant: number = Date.now()): void {
    this.#par.set(missionId, {
      sessionId,
      vivant: true,
      modeleResolu: null,
      etatSdk: 'running',
      coutUsd: 0,
      contexteTokensUtilises: null,
      contexteTokensMax: null,
      contexteVentilation: null,
      derniereActivite: null,
      quotaSature: false,
      motifQuota: null,
      observeA: maintenant,
    });
  }

  /** Poussé pour CHAQUE message lu du worker. Ne lève jamais. */
  ingerer(missionId: string, message: SDKMessage, maintenant: number = Date.now()): void {
    const etat = this.#par.get(missionId);
    if (etat === undefined) return;
    try {
      this.#appliquer(etat, message);
      etat.observeA = maintenant;
    } catch (erreur) {
      log.error({ err: erreur, missionId }, 'télémétrie ignorée sur ce message — surveillance préservée');
    }
  }

  /**
   * Pose l'usage de contexte, mesuré séparément. `☠` Il n'est PAS dans le message
   * `result` : c'est une requête de contrôle (`getContextUsage`), et elle n'est
   * valable que pendant que la session vit — après le `result`, le transport est
   * fermé (fait mesuré le 22/07).
   */
  poserContexte(
    missionId: string,
    utilises: number,
    max: number | null,
    ventilation: readonly PosteContexte[] | null = null,
  ): void {
    const etat = this.#par.get(missionId);
    if (etat === undefined) return;
    etat.contexteTokensUtilises = utilises;
    if (max !== null) etat.contexteTokensMax = max;
    if (ventilation !== null) etat.contexteVentilation = ventilation;
  }

  /** Le worker est mort : on garde son dernier état connu, marqué non vivant. */
  fermer(missionId: string, maintenant: number = Date.now()): void {
    const etat = this.#par.get(missionId);
    if (etat === undefined) return;
    etat.vivant = false;
    etat.etatSdk = 'idle';
    etat.observeA = maintenant;
  }

  tous(): readonly TelemetrieWorker[] {
    return [...this.#par.entries()].map(([missionId, e]) => ({ missionId, ...e }));
  }

  #appliquer(etat: Etat, message: SDKMessage): void {
    const sonde = message as unknown as {
      type: string;
      subtype?: string;
      model?: string;
      total_cost_usd?: number;
      content?: string;
      text?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    if (sonde.type === 'system' && (sonde.subtype === 'informational' || sonde.subtype === 'notification')) {
      const texte = typeof sonde.content === 'string' ? sonde.content : (sonde.text ?? '');
      if (MOTIFS_SATURATION.some((m) => m.test(texte))) {
        etat.quotaSature = true;
        etat.motifQuota = texte.slice(0, APERCU_MAX);
      }
      return;
    }

    if (sonde.type === 'system' && sonde.subtype === 'init') {
      // Le modèle résolu n'est connu qu'ici : le CLI peut résoudre un alias
      // (`opus`) vers un identifiant précis, et c'est celui-là qui compte.
      if (typeof sonde.model === 'string') etat.modeleResolu = sonde.model;
      return;
    }

    if (sonde.type === 'assistant') {
      etat.etatSdk = 'running';
      const texte = texteAssistant(message);
      if (texte !== null) etat.derniereActivite = texte;
      return;
    }

    if (sonde.type === 'result') {
      etat.etatSdk = 'idle';
      // `☠` Valeur ABSOLUE rendue par le SDK, jamais une somme maison : additionner
      // les tours ferait dériver le total dès qu'un message est manqué.
      if (typeof sonde.total_cost_usd === 'number') etat.coutUsd = sonde.total_cost_usd;
    }
  }
}
