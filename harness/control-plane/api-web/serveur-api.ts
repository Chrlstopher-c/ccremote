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
import { enveloppe, ErreurApi, introuvable, requeteInvalide } from './enveloppe.ts';
import { versMissionApi } from './vue-missions.ts';
import { versEscaladeApi } from './vue-escalades.ts';
import { construireFeed } from './vue-feed.ts';
import { versAccountApi } from './vue-comptes.ts';
import { traiterEcriture, type OrdresVersPc, type OrchestrateurConversation } from './ecritures.ts';
import {
  versEvenementApi,
  versConversationApi,
  type PortConversations,
  type PortMandats,
} from './vue-conversations.ts';
import { apiWebLogger } from './logger.ts';

const log = apiWebLogger;

/** Plafond de relances par défaut, affiché dans `retries` (« 1 / 3 »). */
const PLAFOND_RELANCES_DEFAUT = 3;

export interface DependancesApiWeb {
  readonly registre: Registre;
  readonly escalades: MachineEtatsDemandes;
  /** Le lien réel vers le PC — source unique de `pcOnline` (H-75). */
  readonly pcEnLigne: () => boolean;
  /**
   * Ordres vers le PC. Absent ⇒ les routes d'écriture répondent 501 plutôt que
   * d'accepter un ordre qui ne partirait nulle part.
   */
  readonly pc?: OrdresVersPc;
  /** Conversation avec la session orchestrateur maître (opt-in). */
  readonly orchestrateur?: OrchestrateurConversation;
  /**
   * Fils de discussion multi-sessions (type ChatGPT). Absent ⇒ orchestrateur
   * désactivé sur ce déploiement : les routes `/orchestrator/conversations*`
   * répondent 501, jamais une conversation fabriquée.
   */
  readonly conversations?: PortConversations;
  /**
   * Autorisation des mandats (H-61). Absent ⇒ les routes répondent 501 : mieux
   * vaut un bouton absent qu'un bouton qui n'autorise rien.
   */
  readonly mandats?: PortMandats;
  /** Contexte réel de l'orchestrateur (ratio 0-1), lu de la sentinelle. Absent = orchestrateur inactif. */
  readonly orchestrateurContexteRatio?: () => number | null;
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

/** Sous-routage lecture des conversations. `null` = pas une route conversation. */
function routerLectureConversation(chemin: string, url: URL, deps: DependancesApiWeb, pcOnline: boolean): unknown {
  if (deps.conversations === undefined) return null;
  const conv = deps.conversations;

  if (chemin === '/orchestrator/conversations') {
    return enveloppe(pcOnline, conv.listerConversations().map(versConversationApi));
  }

  const evts = chemin.match(/^\/orchestrator\/conversations\/([^/]+)\/events$/);
  if (evts?.[1] !== undefined) {
    const depuis = Number.parseInt(url.searchParams.get('since') ?? '0', 10);
    const resume = conv.evenementsDepuis(decodeURIComponent(evts[1]), Number.isFinite(depuis) ? depuis : 0);
    if (resume === null) throw introuvable('conversation');
    return enveloppe(pcOnline, {
      events: resume.evenements.map(versEvenementApi),
      cursor: resume.curseur,
      generating: resume.genere,
      active: resume.active,
      contextPct: resume.contextePct,
      compactions: resume.compactions,
      // `☠` Le bloc en cours de frappe — c'est LUI qui fait le streaming visible.
      partial: resume.partiel,
    });
  }

  const detail = chemin.match(/^\/orchestrator\/conversations\/([^/]+)$/);
  if (detail?.[1] !== undefined) {
    const d = conv.detail(decodeURIComponent(detail[1]));
    if (d === null) throw introuvable('conversation');
    return enveloppe(pcOnline, {
      id: d.id,
      titre: d.titre,
      events: d.evenements.map(versEvenementApi),
      cursor: d.curseur,
      generating: d.genere,
      active: d.active,
      contextPct: d.contextePct,
      compactions: d.compactions,
      partial: d.partiel,
    });
  }

  return null;
}

/** Routage en lecture. Chaque branche reste courte : la vue fait la traduction. */
function router(chemin: string, url: URL, deps: DependancesApiWeb): unknown {
  const maintenant = deps.maintenant?.() ?? Date.now();
  const pcOnline = deps.pcEnLigne();
  const plafond = deps.plafondRelances ?? PLAFOND_RELANCES_DEFAUT;

  const conversation = routerLectureConversation(chemin, url, deps, pcOnline);
  if (conversation !== null) return conversation;

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
    const feed = construireFeed(deps.registre, trouvee.id, deps.escalades);
    return enveloppe(pcOnline, versMissionApi(trouvee, plafond, maintenant, feed));
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

  if (chemin === '/orchestrator/propositions') {
    const liste = deps.mandats === undefined ? [] : deps.mandats.enAttente();
    return enveloppe(pcOnline, liste);
  }

  if (chemin === '/orchestrator/gauges') {
    // `☠` Le contexte vient de la VRAIE sentinelle. `null` (orchestrateur
    // inactif ou pas encore de mesure) ⇒ `contextPct: null`, jamais un chiffre
    // inventé — l'ancienne UI affichait « 23 % » codé en dur, ce qui mentait.
    const ratio = deps.orchestrateurContexteRatio?.() ?? null;
    return enveloppe(pcOnline, {
      contextPct: ratio === null ? null : Math.round(ratio * 100),
      active: deps.orchestrateurContexteRatio !== undefined,
    });
  }

  if (chemin === '/health') {
    return { ok: true, pcOnline };
  }

  throw new ErreurApi(404, `route inconnue : ${chemin}`);
}

async function lireCorps(req: Request): Promise<Record<string, unknown>> {
  try {
    const brut: unknown = await req.json();
    if (brut !== null && typeof brut === 'object') return brut as Record<string, unknown>;
  } catch {
    // Corps vide ou illisible : accepté, la plupart des ordres n'en ont pas.
  }
  return {};
}

/**
 * Écritures sur les conversations. `☠` Ne dépendent PAS du PC — elles touchent la
 * session orchestrateur sur le Pi. Traitées AVANT le garde `pc` du routage
 * d'ordres, sinon un déploiement sans PC les refuserait à tort. `null` = pas une
 * route conversation.
 */
async function routerEcritureConversation(chemin: string, req: Request, deps: DependancesApiWeb): Promise<unknown> {
  // `☠` Les mandats sont traités AVANT le filtre sur `/orchestrator/conversations` :
  // placés après, ils n'étaient jamais atteints (404 « route inconnue »), et le
  // bouton d'autorisation ne pouvait rien faire.
  const mandat = chemin.match(/^\/orchestrator\/propositions\/([^/]+)\/(approve|reject)$/);
  if (mandat?.[1] !== undefined && mandat[2] !== undefined) {
    if (deps.mandats === undefined) throw new ErreurApi(501, "autorisation des mandats non câblée sur ce déploiement");
    const id = decodeURIComponent(mandat[1]);
    if (mandat[2] === 'reject') {
      if (!deps.mandats.refuser(id)) throw new ErreurApi(409, 'mandat déjà tranché ou inconnu');
      return { ok: true, effet: 'mandat refusé — aucune équipe créée' };
    }
    // `☠` L'approbation DISPATCHE réellement : un échec doit remonter tel quel,
    // jamais être maquillé en succès — l'opérateur croirait son équipe lancée.
    const r = await deps.mandats.approuver(id);
    return { ok: true, effet: r.detail, missionId: r.missionId };
  }

  if (!chemin.startsWith('/orchestrator/conversations')) return null;
  if (deps.conversations === undefined) {
    throw new ErreurApi(501, 'session orchestrateur non active sur ce déploiement (CCREMOTE_PI_ORCHESTRATEUR=1)');
  }
  const conv = deps.conversations;

  if (chemin === '/orchestrator/conversations') {
    const corps = await lireCorps(req);
    const titre = typeof corps['titre'] === 'string' ? corps['titre'] : undefined;
    const creee = conv.creer(titre);
    return { ok: true, effet: 'conversation créée', conversation: versConversationApi({ ...creee, active: false, contextePct: null }) };
  }

  const message = chemin.match(/^\/orchestrator\/conversations\/([^/]+)\/message$/);
  if (message?.[1] !== undefined) {
    const corps = await lireCorps(req);
    const texte = corps['text'];
    if (typeof texte !== 'string' || texte.trim().length === 0) throw requeteInvalide('message vide');
    // `☠` NE bloque pas jusqu'à la réponse : `envoyer` enfile puis rend la main.
    // La réponse remonte par le streaming (GET .../events). Un POST bloquant
    // jusqu'au `result` immobiliserait le relais et Cloudflare le couperait.
    await conv.envoyer(decodeURIComponent(message[1]), texte);
    return { ok: true, effet: 'message envoyé — la réponse arrive en streaming' };
  }

  const compact = chemin.match(/^\/orchestrator\/conversations\/([^/]+)\/compact$/);
  if (compact?.[1] !== undefined) {
    // `☠` `compacte: false` n'est PAS une erreur (rien à compacter, tour en
    // cours) : on rend le motif tel quel plutôt qu'un faux succès, l'interface
    // doit pouvoir dire pourquoi il ne s'est rien passé.
    const r = await conv.compacter(decodeURIComponent(compact[1]));
    return { ok: true, effet: r.detail, compacted: r.compacte };
  }

  const rename = chemin.match(/^\/orchestrator\/conversations\/([^/]+)\/rename$/);
  if (rename?.[1] !== undefined) {
    const corps = await lireCorps(req);
    const titre = corps['titre'];
    if (typeof titre !== 'string' || titre.trim().length === 0) throw requeteInvalide('titre vide');
    if (!conv.renommer(decodeURIComponent(rename[1]), titre)) throw introuvable('conversation');
    return { ok: true, effet: 'conversation renommée' };
  }

  const archive = chemin.match(/^\/orchestrator\/conversations\/([^/]+)\/archive$/);
  if (archive?.[1] !== undefined) {
    if (!conv.archiver(decodeURIComponent(archive[1]))) throw introuvable('conversation');
    return { ok: true, effet: 'conversation archivée' };
  }

  throw new ErreurApi(404, `route conversation inconnue : ${chemin}`);
}

/**
 * Routage en écriture. `☠` Sans port vers le PC, on répond 501 — jamais 200 :
 * accepter un ordre qui ne part nulle part est le pire des deux, parce que
 * l'opérateur croit sa mission arrêtée et n'y revient pas.
 */
async function routerEcriture(chemin: string, req: Request, deps: DependancesApiWeb): Promise<unknown> {
  if (deps.pc === undefined) {
    throw new ErreurApi(501, "aucun lien vers le PC sur ce déploiement — l'ordre n'a pas été transmis");
  }
  let corps: Record<string, unknown> = {};
  try {
    const brut: unknown = await req.json();
    if (brut !== null && typeof brut === 'object') corps = brut as Record<string, unknown>;
  } catch {
    // Corps vide ou illisible : accepté, la plupart des ordres n'en ont pas.
  }
  const resultat = await traiterEcriture(chemin, corps, {
    escalades: deps.escalades,
    pc: deps.pc,
    orchestrateur: deps.orchestrateur,
  });
  if (resultat === null) throw new ErreurApi(404, `route d'écriture inconnue : ${chemin}`);
  return resultat;
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
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      const chemin = url.pathname.replace(/^\/api\/harness/, '');
      try {
        if (req.method === 'POST') {
          const conversation = await routerEcritureConversation(chemin, req, options);
          if (conversation !== null) return json(conversation);
          return json(await routerEcriture(chemin, req, options));
        }
        return json(router(chemin, url, options));
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
