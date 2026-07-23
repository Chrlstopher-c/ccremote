/**
 * Responsabilité : mesurer l'usage des fenêtres de rate limit d'un compte par
 * appel HTTP direct à l'endpoint OAuth, SANS lancer de session Claude Code.
 *
 * `☠` C'est ce qui rend la mesure gratuite et fréquente. La sonde SDK
 * (`sonde-quotas.ts`) ouvrait une session CLI par compte : plusieurs secondes,
 * un process Node, et une session réelle sur le compte qu'on prétend surveiller.
 * D'où un cache de 10 min, donc un écran en retard de 10 min sur la réalité
 * (constaté le 23/07 : 3 % affichés sur un compte réellement à 10 %).
 * Ici, une requête GET — mesurée à ~200 ms, aucun token consommé.
 *
 * `☠` Cette sonde ne RAFRAÎCHIT JAMAIS le token. Les refresh tokens Claude sont
 * TOURNANTS : un refresh émis ici invaliderait celui que le CLI du PC détient,
 * et casserait le compte au prochain démarrage (piège déjà payé, mémoire
 * `ccremote-rotation-comptes-snapshot-perime`). Jeton expiré ⇒ échec explicite,
 * la jauge garde sa dernière valeur et se dit périmée. Seul le CLI refresh.
 */

import { superviseurLogger } from './logger.ts';
import { extraireFenetres, type QuotaCompteMesure } from './sonde-quotas.ts';

const log = superviseurLogger.child({ composant: 'sonde-quotas-http' });

const URL_USAGE = 'https://api.anthropic.com/api/oauth/usage';
const URL_PROFIL = 'https://api.anthropic.com/api/oauth/profile';

/** Version de l'en-tête beta exigée par les endpoints OAuth du CLI. */
const BETA_OAUTH = 'oauth-2025-04-20';

/** Bien au-delà du temps de réponse observé (~200 ms), bien en-deçà de la période de sonde. */
const DELAI_HTTP_MS = 8_000;

interface ProfilBrut {
  readonly account?: { readonly email?: string };
  readonly organization?: { readonly organization_type?: string };
}

/** `claude_pro` ⇒ « Claude Pro ». L'écran affiche des noms, pas des identifiants techniques. */
function libelleAbonnement(type: string | undefined): string | null {
  if (typeof type !== 'string' || type.length === 0) return null;
  return type
    .split('_')
    .map((mot) => (mot === 'claude' ? 'Claude' : mot.charAt(0).toUpperCase() + mot.slice(1)))
    .join(' ');
}

async function lireJson<T>(url: string, jeton: string): Promise<T | null> {
  const reponse = await fetch(url, {
    headers: { authorization: `Bearer ${jeton}`, 'anthropic-beta': BETA_OAUTH },
    signal: AbortSignal.timeout(DELAI_HTTP_MS),
  });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
  return (await reponse.json()) as T;
}

/**
 * `☠` La réponse de l'endpoint OAuth est PLATE (`{five_hour, seven_day,
 * extra_usage, …}`), là où le SDK l'enveloppe dans `rate_limits`. Passer la
 * réponse brute à `extraireFenetres` rendait donc une liste VIDE sans la moindre
 * erreur : jetons persistés, HTTP 200, et zéro jauge écrite (mesuré en prod le
 * 23/07). On ré-enveloppe explicitement plutôt que d'assouplir l'extraction —
 * une extraction qui accepte les deux formes accepterait aussi n'importe quoi.
 */
export function enveloppeUsage(plat: Record<string, unknown> | null): Parameters<typeof extraireFenetres>[0] {
  return { rate_limits: plat ?? {} } as Parameters<typeof extraireFenetres>[0];
}

/**
 * Sonde un compte à partir de son jeton d'accès. Ne lève JAMAIS : un compte
 * injoignable rend un échec explicite, jamais une exception qui priverait les
 * autres comptes de leur mesure, ni un « 0 % » qui ferait croire à un compte libre.
 */
export async function sonderQuotaHttp(
  compteId: string,
  jetonAcces: string,
  maintenant: number = Date.now(),
): Promise<QuotaCompteMesure> {
  try {
    const plat = await lireJson<Record<string, unknown>>(URL_USAGE, jetonAcces);
    const usage = enveloppeUsage(plat);
    // Le profil est un COMPLÉMENT : son échec ne doit pas perdre les jauges.
    let profil: ProfilBrut | null = null;
    try {
      profil = await lireJson<ProfilBrut>(URL_PROFIL, jetonAcces);
    } catch (erreur) {
      log.debug({ err: erreur, compteId }, 'profil non lu — jauges conservées, identité laissée en l’état');
    }
    return {
      compteId,
      fenetres: extraireFenetres(usage),
      email: profil?.account?.email ?? null,
      typeAbonnement: libelleAbonnement(profil?.organization?.organization_type),
      creditsPayantsActifs: (plat?.extra_usage as { is_enabled?: boolean } | null)?.is_enabled === true,
      observeA: Date.now(),
    };
  } catch (erreur) {
    const detail = erreur instanceof Error ? erreur.message : 'échec inconnu';
    log.debug({ compteId, detail }, 'sonde HTTP en échec — jauge laissée à sa dernière valeur connue');
    return {
      compteId,
      fenetres: [],
      email: null,
      typeAbonnement: null,
      creditsPayantsActifs: false,
      observeA: maintenant,
      echec: detail,
    };
  }
}

export interface JetonCompte {
  readonly compteId: string;
  readonly jetonAcces: string;
  /** Epoch ms. Passé ⇒ inutile d'appeler : l'API répondrait 401. */
  readonly expireA: number;
}

/**
 * Sonde tous les comptes dont le jeton est encore valide. `☠` En PARALLÈLE,
 * contrairement à la sonde SDK : ce sont deux requêtes HTTP, pas deux process.
 * Un jeton expiré rend un échec explicite sans appel réseau — l'écran doit
 * pouvoir dire « mesure périmée », pas afficher un zéro inventé.
 */
export async function sonderQuotasHttp(
  jetons: readonly JetonCompte[],
  maintenant: number = Date.now(),
): Promise<readonly QuotaCompteMesure[]> {
  return Promise.all(
    jetons.map((j) =>
      j.expireA <= maintenant
        ? Promise.resolve<QuotaCompteMesure>({
            compteId: j.compteId,
            fenetres: [],
            email: null,
            typeAbonnement: null,
            creditsPayantsActifs: false,
            observeA: maintenant,
            echec: "jeton d'accès expiré — le PC doit le renouveler",
          })
        : sonderQuotaHttp(j.compteId, j.jetonAcces, maintenant),
    ),
  );
}
