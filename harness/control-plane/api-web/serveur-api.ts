/**
 * Responsabilité : le point d'entrée HTTP du control plane — ce que
 * `pi-web/app.py` relaie sous `/api/harness/...` (contrat :
 * `pi-web/CONTRAT-API-HARNESS.md`).
 *
 * `☠ JAMAIS EXPOSÉ DIRECTEMENT` — ce serveur écoute par défaut sur
 * `127.0.0.1` et n'a AUCUNE authentification propre. C'est délibéré : il est
 * précédé de `pi-web`, qui porte déjà la session et le mot de passe. Dupliquer
 * l'authentification ici créerait deux vérités sur « qui a le droit », et la
 * plus permissive gagnerait toujours en silence. En contrepartie, l'écoute sur
 * une interface publique est un défaut de configuration grave : d'où le refus
 * explicite de démarrer sur `0.0.0.0` plus bas, plutôt qu'un avertissement
 * qu'on ne lirait pas.
 *
 * `☠` Ce serveur ne PROPOSE que la lecture pour l'instant. Les écritures
 * (instruction, pause, arrêt d'urgence) traversent le lien vers le PC et
 * portent des conséquences réelles ; elles arriveront quand le chemin d'écriture
 * aura son propre banc d'assemblage. Une route d'écriture à moitié câblée est
 * pire qu'absente : l'interface croirait l'ordre passé.
 */

import type { Server } from 'bun';
import type { Registre } from '../registre/index.ts';
import type { MachineEtatsDemandes } from '../bus-permissions/index.ts';
import { enveloppe, ErreurApi, introuvable } from './enveloppe.ts';
import { versMissionApi } from './vue-missions.ts';
import { versEscaladeApi } from './vue-escalades.ts';
import { versAccountApi } from './vue-comptes.ts';
import { apiWebLogger } from './logger.ts';

const log = apiWebLogger;

/** Plafond de relances par défaut, affiché dans `retries` (« 1 / 3 »). */
const PLAFOND_RELANCES_DEFAUT = 3;

export interface DependancesApiWeb {
  readonly registre: Registre;
  readonly escalades: MachineEtatsDemandes;
  /** Le lien réel vers le PC — source unique de `pcOnline` (H-75). */
  readonly pcEnLigne: () => boolean;
  readonly maintenant?: () => number;
  readonly plafondRelances?: number;
}

export interface OptionsServeurApiWeb extends DependancesApiWeb {
  readonly port: number;
  /** `127.0.0.1` par défaut. Toute autre valeur d'écoute publique est REFUSÉE. */
  readonly hostname?: string;
}

export interface ServeurApiWeb {
  readonly port: number;
  arreter(): void;
}

const HOTES_PUBLICS = new Set(['0.0.0.0', '::', '*']);

function json(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Routage en lecture. Chaque branche reste courte : la vue fait la traduction. */
function router(chemin: string, deps: DependancesApiWeb): unknown {
  const maintenant = deps.maintenant?.() ?? Date.now();
  const pcOnline = deps.pcEnLigne();
  const plafond = deps.plafondRelances ?? PLAFOND_RELANCES_DEFAUT;

  if (chemin === '/missions') {
    const missions = deps.registre.missions.listerRecentes().map((m) => versMissionApi(m, plafond, maintenant));
    return enveloppe(pcOnline, missions);
  }

  const mission = chemin.match(/^\/missions\/([^/]+)$/);
  if (mission?.[1] !== undefined) {
    const trouvee = deps.registre.missions.lire(decodeURIComponent(mission[1]));
    // `☠` Une mission inconnue avec le PC EN LIGNE est un vrai 404 ; le PC
    // absent ne doit jamais transformer « inconnue » en « peut-être plus tard ».
    if (trouvee === null) throw introuvable('mission');
    return enveloppe(pcOnline, versMissionApi(trouvee, plafond, maintenant));
  }

  if (chemin === '/escalades') {
    const file = deps.escalades.enAttente().map((d) => versEscaladeApi(d, maintenant));
    return enveloppe(pcOnline, file);
  }

  if (chemin === '/accounts') {
    const comptes = deps.registre.comptes
      .lister()
      .map((c) => versAccountApi(c, deps.registre.comptes.listerQuotas(c.id), maintenant));
    return enveloppe(pcOnline, comptes);
  }

  if (chemin === '/health') {
    return { ok: true, pcOnline };
  }

  throw new ErreurApi(404, `route inconnue : ${chemin}`);
}

export function demarrerServeurApiWeb(options: OptionsServeurApiWeb): ServeurApiWeb {
  const hostname = options.hostname ?? '127.0.0.1';
  if (HOTES_PUBLICS.has(hostname)) {
    // Échec bruyant plutôt qu'avertissement (H-74, point 2) : ce serveur n'a
    // pas d'authentification, l'exposer publiquement ouvrirait le parc entier.
    throw new Error(
      `refus de démarrer l'API du harness sur ${hostname} : ce serveur n'a aucune authentification propre et doit rester derrière pi-web (127.0.0.1)`,
    );
  }

  // `Server<never>` : ce serveur ne fait AUCUN upgrade WebSocket — le seul lien
  // du Pi est celui vers le PC (`composition/pi/serveur-lien-pc.ts`).
  const server: Server<never> = Bun.serve<never>({
    port: options.port,
    hostname,
    fetch(req): Response {
      const chemin = new URL(req.url).pathname.replace(/^\/api\/harness/, '');
      try {
        return json(router(chemin, options));
      } catch (erreur) {
        if (erreur instanceof ErreurApi) return json({ error: erreur.message }, erreur.statut);
        // `☠` Une panne du control plane reste une VRAIE erreur HTTP — jamais
        // déguisée en `pcOnline: false`, qui ferait afficher « tout va bien,
        // données un peu vieilles » sur un serveur cassé.
        log.error({ err: erreur, chemin }, "échec interne de l'API du harness");
        return json({ error: 'erreur interne du control plane' }, 500);
      }
    },
  });

  const portEcoute = server.port;
  if (portEcoute === undefined) throw new Error('API du harness démarrée sans port TCP — configuration inattendue');
  log.info({ port: portEcoute, hostname }, "API web du harness démarrée (lecture seule, derrière pi-web)");

  return {
    port: portEcoute,
    arreter: (): void => {
      server.stop(true);
    },
  };
}
