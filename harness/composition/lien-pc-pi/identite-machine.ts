/**
 * Responsabilité : l'IDENTITÉ d'une machine de travail sur le lien Pi↔machine.
 * Répond à une seule question — « qui se présente ? » — que le secret partagé
 * ne peut pas répondre : il est le MÊME pour toutes les machines, par
 * construction (une seule valeur des deux côtés). Sans identité distincte,
 * deux superviseurs authentifiés sont indiscernables.
 *
 * `☠` Fichier SÉPARÉ de `secret.ts` à dessein. Ce dernier a une responsabilité
 * unique — authentifier — et une identité de machine n'est PAS un secret : elle
 * est journalisée, affichée à l'écran, écrite en base. Les mélanger inviterait
 * à traiter l'une avec les précautions de l'autre, dans un sens comme dans
 * l'autre (identité comparée en temps constant pour rien, ou secret journalisé
 * par mégarde).
 *
 * `☠` Voyage en EN-TÊTE, jamais en paramètre d'URL — même raison que le secret
 * (`secret.ts`, défaut trouvé en relecture le 22/07) : le lien traverse
 * Cloudflare Tunnel, dont les access logs enregistrent les query-strings. Ici
 * la fuite serait bénigne, mais une URL qui porte un paramètre invite à en
 * porter un second, et le second peut être sensible.
 *
 * `☠` L'identité est une ENTRÉE EXTERNE : elle arrive d'un client distant, sert
 * de clé de Map, de valeur journalisée et de colonne en base. Elle est donc
 * normalisée puis validée contre un jeu accepté AVANT tout usage, exactement
 * comme la doctrine « model output is untrusted input » l'exige d'une valeur
 * produite par un modèle (`rules/code-standards.md`). Refus explicite plutôt
 * que troncature silencieuse : une identité tronquée ferait cohabiter deux
 * machines sous le même nom, ce qui ramène précisément la tempête d'évictions
 * que l'identité existe pour supprimer.
 */

/** En-tête portant l'identité de la machine à l'upgrade WebSocket. */
export const ENTETE_MACHINE = 'x-ccremote-machine';

/**
 * 63 caractères : la longueur d'un label DNS, et largement au-delà de tout
 * `hostname()` réel. Assez court pour rester lisible dans un journal et sur une
 * carte d'équipe, assez long pour ne jamais tronquer un nom légitime.
 */
export const LONGUEUR_MAX_MACHINE = 63;

const MOTIF_MACHINE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Forme canonique d'une identité de machine, ou `null` si elle est inutilisable.
 *
 * `☠` Rend `null` plutôt que de réparer : « à peu près valide » n'existe pas
 * pour une clé d'identité. Un appelant qui reçoit `null` doit refuser, pas
 * inventer un nom de repli — une identité par défaut partagée ferait cohabiter
 * deux machines sous le même nom sans que rien ne le dise (H-74 : jamais de
 * dégradation silencieuse).
 */
export function normaliserMachineId(brut: string | null | undefined): string | null {
  if (typeof brut !== 'string') return null;
  const propre = brut.trim().toLowerCase();
  if (propre.length === 0 || propre.length > LONGUEUR_MAX_MACHINE) return null;
  if (!MOTIF_MACHINE.test(propre)) return null;
  return propre;
}

/** En-tête d'identité à joindre à la requête d'upgrade, côté machine de travail. */
export function entetesMachine(machineId: string): Record<string, string> {
  return { [ENTETE_MACHINE]: machineId };
}

/**
 * Extrait l'identité d'une requête d'upgrade entrante, côté Pi.
 * `null` ⇒ client trop ancien ou identité malformée : la connexion doit être
 * REFUSÉE, jamais rattachée à une identité de repli (voir `normaliserMachineId`).
 */
export function extraireMachineId(req: Request): string | null {
  return normaliserMachineId(req.headers.get(ENTETE_MACHINE));
}
