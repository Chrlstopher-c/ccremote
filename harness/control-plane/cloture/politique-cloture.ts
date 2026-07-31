/**
 * Responsabilité : décider quelles missions au repos ont assez attendu pour être
 * closes. Pur, aucune I/O.
 *
 * `☠` LE défaut mesuré le 2026-08-01 : une équipe finit son tour, passe `idle`,
 * et RIEN ne la clôt. Or `en_cours` occupe le projet (H-56) — donc un lead qui a
 * parfaitement travaillé verrouille son projet pour toujours, et le dispatch
 * suivant est refusé par « une équipe est déjà active sur /mnt/projects/echohub ».
 * Constaté avec une équipe idle depuis 16 min et un parc qui n'affichait aucune
 * équipe active.
 *
 * Pourquoi ne PAS clore dès `running → idle`, la solution qui vient d'abord :
 * `idle` veut dire « le lead a fini de parler », pas « le lead a fini ». C'est
 * exactement l'état dans lequel on lui réinjecte un message (`envoyer_message_equipe`)
 * pour prolonger son travail sans repayer un démarrage. Clore immédiatement
 * supprimerait cette capacité.
 *
 * Pourquoi ne PAS retirer `en_cours`+idle des états occupants, la deuxième idée :
 * la session vit encore et TIENT son worktree. Deux Claude Code écrivant dans le
 * même arbre est précisément le désastre que H-56 empêche.
 *
 * D'où le délai. Il arbitre entre deux coûts asymétriques :
 *   - clore trop tôt coûte UNE relance — `relancer_equipe` reprend la session par
 *     son `sessionId`, qui survit à la clôture, donc le contexte n'est pas perdu ;
 *   - clore trop tard coûte un projet verrouillé, sans aucun moyen de le voir
 *     depuis le parc, jusqu'à ce qu'un humain clique.
 * Asymétrie franche ⇒ délai court.
 */

import type { Mission } from '../registre/index.ts';

/**
 * `☠` Chiffre choisi, pas mesuré — et l'arbitrage est écrit au-dessus. Quinze
 * minutes laissent à l'orchestrateur le temps de lire le rapport et de réinjecter
 * (il réagit en secondes quand la notification le réveille), et à Chris le temps
 * de parcourir un fil avant de reprendre la main.
 */
export const DELAI_CLOTURE_IDLE_MS = 15 * 60_000;

export const MOTIF_CLOTURE_IDLE = 'clôturée automatiquement — au repos sans instruction';

/**
 * Missions à clore maintenant.
 *
 * `☠` `etatSdk === 'idle'` STRICTEMENT : une équipe bloquée sur une autorisation
 * est `requires_action`, pas `idle`. La clore reviendrait à tuer un travail qui
 * n'attend qu'un clic — l'exact opposé du but.
 */
export function missionsAClore(
  missions: readonly Mission[],
  maintenant: number,
  delaiMs: number = DELAI_CLOTURE_IDLE_MS,
): readonly Mission[] {
  return missions.filter((m) => {
    if (m.etatHarness !== 'en_cours') return false;
    if (m.etatSdk !== 'idle') return false;
    // Sans repère de transition, on ne sait pas DEPUIS QUAND : on ne clôt pas.
    if (m.etatSdkMajA === null) return false;
    return maintenant - m.etatSdkMajA >= delaiMs;
  });
}
