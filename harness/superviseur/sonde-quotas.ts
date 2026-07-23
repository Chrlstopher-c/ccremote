/**
 * Responsabilité : mesurer l'usage RÉEL des fenêtres de rate limit d'un compte
 * Claude, côté PC — c'est là que vivent les `CLAUDE_CONFIG_DIR`.
 *
 * `☠` Les jauges de l'interface affichaient 0 % et « reset — » sur tous les
 * comptes, en permanence : `releverQuota()` n'était appelé QUE pour marquer une
 * saturation. Personne n'a jamais mesuré l'usage courant (constaté le 23/07).
 *
 * `☠` `usage_EXPERIMENTAL_…` est une méthode de contrôle : elle n'est valable que
 * PENDANT que la session vit. Après le message `result`, le transport est fermé
 * et l'appel échoue en « ProcessTransport is not ready for writing » (mesuré le
 * 22/07). La sonde interroge donc dès `init` et arrête tout de suite.
 *
 * `☠` `env` REMPLACE l'environnement, il ne le complète pas : sans
 * `...process.env`, le PATH est perdu et le CLI est introuvable.
 */

import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { superviseurLogger } from './logger.ts';

const log = superviseurLogger.child({ composant: 'sonde-quotas' });

/** Au-delà, on considère la sonde perdue et on rend ce qu'on a. */
const DELAI_SONDE_MS = 30_000;

export interface FenetreQuotaMesuree {
  readonly typeFenetre: string;
  readonly utilisation: number;
  readonly resetA: number | null;
}

export interface QuotaCompteMesure {
  readonly compteId: string;
  readonly fenetres: readonly FenetreQuotaMesuree[];
  readonly email: string | null;
  readonly typeAbonnement: string | null;
  /** Crédits payants activés sur ce compte (dépassement facturé). */
  readonly creditsPayantsActifs: boolean;
  readonly observeA: number;
  /** Renseigné quand la mesure a échoué — jamais confondu avec « 0 % ». */
  readonly echec?: string;
}

interface FenetreBrute {
  readonly utilization?: number;
  readonly resets_at?: string | number;
}

interface UsageBrut {
  readonly rate_limits?: Record<string, unknown> & {
    readonly extra_usage?: { readonly is_enabled?: boolean } | null;
  };
}

/** `resets_at` arrive en ISO ou en secondes epoch selon les versions. Les deux sont acceptés. */
function versHorodatage(valeur: string | number | undefined): number | null {
  if (typeof valeur === 'number') return valeur > 1e12 ? valeur : valeur * 1000;
  if (typeof valeur !== 'string' || valeur.length === 0) return null;
  const ms = Date.parse(valeur);
  return Number.isNaN(ms) ? null : ms;
}

function extraireFenetres(usage: UsageBrut | null): readonly FenetreQuotaMesuree[] {
  const limites = usage?.rate_limits;
  if (limites === undefined || limites === null) return [];
  const fenetres: FenetreQuotaMesuree[] = [];
  for (const [nom, valeur] of Object.entries(limites)) {
    // `extra_usage` n'est pas une fenêtre : le traiter comme telle inventerait un quota.
    if (nom === 'extra_usage' || valeur === null || typeof valeur !== 'object') continue;
    const f = valeur as FenetreBrute;
    if (typeof f.utilization !== 'number') continue;
    fenetres.push({ typeFenetre: nom, utilisation: f.utilization, resetA: versHorodatage(f.resets_at) });
  }
  return fenetres;
}

async function appelerControle<T>(flux: unknown, nom: string): Promise<T | null> {
  const methode = (flux as Record<string, unknown>)[nom];
  if (typeof methode !== 'function') return null;
  try {
    return (await (methode as () => Promise<T>).call(flux)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Sonde un compte. Ne lève JAMAIS : un compte injoignable rend un échec explicite,
 * pas une exception qui priverait les autres comptes de leur mesure.
 *
 * `☠` Le prompt est minuscule mais NON VIDE : sur un flux silencieux, `init`
 * n'est jamais émis et l'attente est un interblocage (piège mesuré).
 */
export async function sonderQuotaCompte(
  compteId: string,
  configDir: string,
  maintenant: number = Date.now(),
): Promise<QuotaCompteMesure> {
  const vide: QuotaCompteMesure = {
    compteId,
    fenetres: [],
    email: null,
    typeAbonnement: null,
    creditsPayantsActifs: false,
    observeA: maintenant,
  };
  const options: Options = {
    permissionMode: 'bypassPermissions',
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
  };
  try {
    const flux = query({ prompt: 'ok', options });
    const minuterie = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), DELAI_SONDE_MS));
    const lecture = (async (): Promise<QuotaCompteMesure> => {
      for await (const message of flux as AsyncIterable<SDKMessage>) {
        const m = message as { type: string; subtype?: string };
        if (m.type !== 'system' || m.subtype !== 'init') continue;
        const info = await appelerControle<{ email?: string; subscriptionType?: string }>(flux, 'accountInfo');
        const usage = await appelerControle<UsageBrut>(
          flux,
          'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET',
        );
        return {
          compteId,
          fenetres: extraireFenetres(usage),
          email: info?.email ?? null,
          typeAbonnement: info?.subscriptionType ?? null,
          creditsPayantsActifs: usage?.rate_limits?.extra_usage?.is_enabled === true,
          observeA: Date.now(),
        };
      }
      return { ...vide, echec: 'aucun message init reçu' };
    })();
    const resultat = await Promise.race([lecture, minuterie]);
    // `☠` Toujours interrompre : sans cet appel, la session sondée continue de
    // vivre et consomme du quota — exactement ce qu'on cherche à surveiller.
    try {
      await (flux as { interrupt?: () => Promise<void> }).interrupt?.();
    } catch {
      // Session déjà close : régime nominal.
    }
    if (resultat === 'timeout') return { ...vide, echec: 'sonde expirée' };
    return resultat;
  } catch (erreur) {
    log.warn({ err: erreur, compteId }, 'sonde de quota impossible — jauge laissée non mesurée');
    return { ...vide, echec: erreur instanceof Error ? erreur.message : 'échec inconnu' };
  }
}

/**
 * Sonde tous les comptes, en SÉRIE. `☠` Jamais en parallèle : plusieurs CLI
 * lancés d'un coup sur une machine de développement, c'est autant de process
 * Node concurrents pour une simple lecture de jauge.
 */
export async function sonderQuotas(
  comptes: readonly { readonly id: string; readonly configDir: string }[],
): Promise<readonly QuotaCompteMesure[]> {
  const mesures: QuotaCompteMesure[] = [];
  for (const compte of comptes) {
    mesures.push(await sonderQuotaCompte(compte.id, compte.configDir));
  }
  return mesures;
}
