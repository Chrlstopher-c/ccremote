/**
 * Responsabilité : groupe « service » de la surface d'outils (A.2.2) — pilotage
 * des services systemd du Raspberry Pi : `etat_service` (lecture pure) et
 * `piloter_service` (redémarrage). Même patron que `outils-machine.ts`, pour
 * une cible différente : pas la machine elle-même, une unité qui tourne dessus.
 *
 * `☠ POURQUOI PAS LE CANAL D.3 (H-75).` `etat_machine` traverse le canal de
 * contrôle parce que le PC est une machine DISTANTE. Ici, les unités visées
 * tournent SUR LA MÊME machine que ce serveur MCP (le Pi héberge
 * `ccremote-harness`, voir `ccremote-harness.service`) : il n'y a rien à
 * traverser. Le précédent est `reveil-wol.ts` — un module de composition qui
 * parle directement au système d'exploitation, sans passer par
 * `ParcSuperviseurs`. Voir `composition/pi/service-systeme.ts`.
 *
 * `machine` est un `z.enum(['pi'])` fermé côté `serveur.ts`, symétrique au
 * `z.enum(['pc'])` d'`outils-machine.ts`. `☠` Étendre à `'pc'` exigerait un
 * chemin DIFFÉRENT — un aller-retour sur le canal D.3 jusqu'à la machine de
 * travail, qui n'a pas de `systemctl` à interroger de la même façon (elle n'est
 * même pas nécessairement Linux) — et n'est délibérément PAS fait ici.
 *
 * `☠ IDEMPOTENCE — NON APPLICABLE ICI.` Les opérations mutatives du canal D.3
 * (`canal-controle.ts`) tiennent un cache `opId ⇒ réponse` parce qu'un LIEN
 * RÉSEAU peut retransmettre une requête (retry côté appelant, coupure). Cet
 * outil-ci ne traverse aucun lien : c'est un appel de fonction synchrone dans
 * le même process, vers `execFile` local. Un double appel ne peut venir que
 * d'une décision du modèle de rappeler l'outil deux fois — ce n'est pas un
 * problème de transport à couvrir par un cache, et `systemctl restart` est
 * lui-même idempotent au sens opérationnel (un second restart redémarre encore,
 * ce qui est le résultat demandé, pas une corruption).
 *
 * ═══ LA LISTE BLANCHE — CŒUR DE LA SÛRETÉ (☠) ═══
 *
 * `service` est un `z.enum` FERMÉ côté `serveur.ts`, JAMAIS un `z.string()` —
 * une chaîne libre serait une exécution arbitraire déguisée en paramètre
 * d'outil (rules/code-standards.md, « model output is untrusted input »).
 * Classification décidée par l'orchestrateur, validée par l'opérateur, tenue
 * ICI en un seul endroit pour qu'ajouter un service soit un geste explicite et
 * relu — jamais une modification discrète d'un enum lointain.
 *
 * Trois seaux :
 *
 *  - SEAU 1 (`SEAU_1_JAMAIS_EXPOSE`, ci-dessous) — n'apparaît dans AUCUN enum,
 *    ni `etat_service` ni `piloter_service` :
 *      · `semantic-memory-http`, `semantic-memory-embed` — écrivain UNIQUE de
 *        la mémoire sémantique ; un redémarrage en pleine écriture corrompt.
 *      · `ccremote-harness`, `ccremote-web` — HÉBERGENT l'orchestrateur qui
 *        appelle cet outil. Un restart ici est un suicide en cours de phrase :
 *        le process qui exécute la commande ne survivrait pas pour en lire le
 *        résultat.
 *      · `cloudflared` — le tunnel d'accès distant. S'il tombe pendant que
 *        l'opérateur est hors du LAN, plus personne ne peut le relever : aucun
 *        chemin de secours vers le Pi ne survit à sa propre extinction.
 *
 *  - SEAU 2 (`SEAU_2_ETAT_SEULEMENT`) — `etat_service` SEULEMENT :
 *    `stockiop-ops-backend`, `license-server`, `web-platform-backend`,
 *    `web-platform-frontend`, `homelab-dns`, `homelab-proxy`. De la
 *    production, dont de la production CLIENT ; un DNS ou un proxy qui tombe
 *    casse en cascade tout ce qui en dépend — visible, mais reversible
 *    seulement par un humain qui comprend l'impact, pas par un redémarrage
 *    décidé au fil d'une conversation.
 *
 *  - SEAU 3 (`SEAU_3_DEUX_OUTILS`) — les deux outils : `portfolio`,
 *    `nullnode-relay`. Impact faible, panne visible immédiatement, relance
 *    sans effet de bord connu.
 *
 * `etat_service` expose SEAU 2 + SEAU 3. `piloter_service` expose SEAU 3 SEUL.
 *
 * `☠ RÉSERVE D'INVENTAIRE.` Cette liste vient d'un relevé du Pi daté du 17/07,
 * complété le 01/08 — PAS d'une mesure en direct au moment où ce code
 * s'exécute. Un service a pu être renommé, désactivé ou supprimé depuis
 * (`stockiop-api`, par exemple, a migré vers le VPS). Ce module N'A PAS accès
 * au Pi pour vérifier : une unité absente de systemd (`LoadState=not-found`,
 * voir `service-systeme.ts`) produit donc un `refuse` explicite et lisible,
 * jamais une erreur brute qui laisserait croire à un bug plutôt qu'à un
 * inventaire périmé.
 *
 * ═══ OBSTACLE SUDO — ÉTABLI FACTUELLEMENT AU DÉPÔT DE CETTE MISSION ═══
 *
 * `ccremote-harness` tourne en `User=pi` (non-root). `systemctl is-active` et
 * `systemctl show` sont des LECTURES : systemd/polkit les autorisent à tout
 * utilisateur local sans configuration supplémentaire — `etat_service`
 * fonctionne donc sans aucun geste préalable de l'opérateur. `systemctl
 * restart` sur une unité SYSTÈME invoque en revanche l'action polkit
 * `org.freedesktop.systemd1.manage-units`, refusée PAR DÉFAUT à un utilisateur
 * non-root sur Raspberry Pi OS/Debian — aucune règle sudoers pour `pi` n'existe
 * dans ce dépôt ni ses scripts de déploiement (grep vérifié au dépôt de cette
 * mission). `piloter_service` échouera donc systématiquement tant que
 * l'opérateur n'a pas ajouté, sur le Pi, la règle sudoers exacte donnée dans
 * `service-systeme.ts` — ce module la NOMME dans le `refuse`, il ne l'écrit
 * jamais lui-même.
 */

import { echecInattendu, refuse, applique } from './contrat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import type {
  ContratRetour,
  EtatServiceSysteme,
  LecteurServiceSysteme,
  PiloteServiceSysteme,
} from './types.ts';

/** Seule valeur acceptée aujourd'hui — voir l'en-tête de fichier (extension `'pc'` non faite). */
export type MachinePi = 'pi';

/** ☠ JAMAIS EXPOSÉ — n'apparaît dans AUCUN enum. Voir l'en-tête pour les raisons, par service. */
export const SEAU_1_JAMAIS_EXPOSE = [
  'semantic-memory-http',
  'semantic-memory-embed',
  'ccremote-harness',
  'ccremote-web',
  'cloudflared',
] as const;

/** `etat_service` SEULEMENT — production, dont production client (voir l'en-tête). */
export const SEAU_2_ETAT_SEULEMENT = [
  'stockiop-ops-backend',
  'license-server',
  'web-platform-backend',
  'web-platform-frontend',
  'homelab-dns',
  'homelab-proxy',
] as const;

/** `etat_service` ET `piloter_service` — impact faible, relance sans effet de bord connu. */
export const SEAU_3_DEUX_OUTILS = ['portfolio', 'nullnode-relay'] as const;

/** Enum exposé par `etat_service` (`serveur.ts`) — SEAU 2 + SEAU 3. */
export const SERVICES_ETAT_SERVICE = [...SEAU_2_ETAT_SEULEMENT, ...SEAU_3_DEUX_OUTILS] as const;
/** Enum exposé par `piloter_service` (`serveur.ts`) — SEAU 3 SEUL. */
export const SERVICES_PILOTER_SERVICE = [...SEAU_3_DEUX_OUTILS] as const;

export type ServiceLisible = (typeof SERVICES_ETAT_SERVICE)[number];
export type ServicePilotable = (typeof SERVICES_PILOTER_SERVICE)[number];

/** `restart` UNIQUEMENT au premier déploiement — voir l'en-tête pour le pourquoi. */
export type ActionService = 'restart';

function resumerEtatService(e: EtatServiceSysteme): string {
  const sousEtat = e.sousEtat === null ? '' : ` (${e.sousEtat})`;
  const depuis = e.depuis === null ? '' : ` depuis ${e.depuis}`;
  return `service=${e.service} · etat=${e.actif}${sousEtat}${depuis}`;
}

/** Message de refus commun à `etat_service` et `piloter_service` sur unité inconnue (réserve d'inventaire). */
function refusUniteInconnue(intention: string, machine: MachinePi, service: string): ContratRetour {
  return refuse(
    intention,
    `unité « ${service} » introuvable sur ${machine} — a pu être renommée, désactivée ou supprimée depuis ` +
      `l'inventaire du 17/07 (complété 01/08) : cette liste n'est pas une mesure en direct`,
  );
}

/**
 * `etat_service` (A.2.2) — lecture pure de l'état d'une unité systemd du Pi.
 *
 * `☠` Délègue à `LecteurServiceSysteme` (`service-systeme.ts`, LOCAL au Pi) :
 * ce module ne lance lui-même aucune commande, aucun shell — voir l'en-tête
 * pour l'obligation `execFile` sans interpolation, tenue côté composition.
 */
export async function etatService(
  lecteur: LecteurServiceSysteme,
  machine: MachinePi,
  service: ServiceLisible,
): Promise<ContratRetour> {
  const intention = `état du service ${service} sur ${machine}`;
  try {
    const etat = await lecteur.etatService(service);
    if (etat === null) return refusUniteInconnue(intention, machine, service);
    return applique(intention, resumerEtatService(etat));
  } catch (erreur) {
    journal.error({ err: erreur, machine, service }, 'etat_service en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * `piloter_service` (A.2.2) — redémarrage d'une unité systemd du Pi, SEAU 3
 * SEULEMENT (voir l'en-tête).
 *
 * `☠ `restart` SEUL, PAS `start`/`stop`.` Un `stop` sans `start` correspondant
 * laisse un service de prod éteint sans aucun garde-fou qui le relance — c'est
 * un mode de panne que ce harness n'a aucun moyen de détecter ni de réparer
 * seul. Un `start` sur un service déjà actif n'apporte rien qu'un `restart` ne
 * couvre déjà (systemd le traite comme un no-op ou un redémarrage selon
 * l'unité) : exposer les deux actions doublerait la surface sans ajouter de
 * capacité réelle. `restart` couvre le seul besoin mesuré : « ce service se
 * comporte mal, relance-le. »
 *
 * `☠` Rend `refuse` — jamais une exception brute — quand l'obstacle sudo
 * (voir l'en-tête) bloque la commande : `service-systeme.ts` catégorise
 * l'échec (`permission` / `inconnu` / `autre`) et fournit un `detail` déjà
 * actionnable, que cette fonction relaie tel quel.
 */
export async function piloterService(
  piloteur: PiloteServiceSysteme,
  machine: MachinePi,
  service: ServicePilotable,
  action: ActionService,
): Promise<ContratRetour> {
  const intention = `${action} du service ${service} sur ${machine}`;
  try {
    const resultat = await piloteur.redemarrer(service);
    if (resultat.ok) return applique(intention, `service ${service} redémarré`);
    if (resultat.motif === 'inconnu') return refusUniteInconnue(intention, machine, service);
    return refuse(intention, resultat.detail);
  } catch (erreur) {
    journal.error({ err: erreur, machine, service, action }, 'piloter_service en échec');
    return echecInattendu(intention, erreur);
  }
}
