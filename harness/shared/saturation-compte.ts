/**
 * Responsabilité : LA définition unique de « ce compte a atteint sa limite ».
 *
 * `☠` Cette règle vivait DUPLIQUÉE dans deux fichiers (`superviseur/collecteur-
 * telemetrie.ts` pour les workers, `control-plane/orchestrateur/collecteur-
 * conversation.ts` pour l'orchestrateur). Les deux listes ont divergé de la
 * réalité en même temps, et la rotation de compte ne s'est jamais déclenchée :
 * une règle métier dupliquée est une règle métier qu'on oublie de corriger
 * quelque part. Un seul endroit, désormais.
 *
 * `☠ MESURÉ EN PROD (23/07)` — le CLI annonce la limite en anglais, sous des
 * formes que rien n'unifie :
 *   « You've hit your weekly limit · resets Jul 26, 9pm (Europe/Paris) »
 *   « You've hit your monthly spend limit »
 *   « You've used 80% of your five-hour limit. »
 * L'ancienne liste cherchait `spend limit`, `usage limit`, `rate limit`,
 * `quota exceeded` : la forme « weekly limit », la plus courante sur abonnement,
 * n'en déclenchait AUCUNE. Le compte restait tenu pour disponible, l'orchestrateur
 * renvoyait sur le compte mort, et l'opérateur voyait deux fois la même erreur.
 *
 * `☠` Le message arrive tantôt en message SYSTÈME, tantôt en TEXTE ASSISTANT
 * (mesuré le 23/07) : les deux points d'entrée doivent interroger cette fonction.
 */

/**
 * Formes RÉELLEMENT observées, jamais devinées. Chaque motif ajouté ici doit
 * l'être sur la foi d'un message effectivement reçu — un motif spéculatif trop
 * large écarterait un compte sain, ce qui coûte plus cher qu'une détection
 * manquée (on perd la capacité, pas seulement la rotation).
 */
const MOTIFS_SATURATION: readonly RegExp[] = [
  // `hit your … limit` couvre weekly / monthly / usage / spend d'un seul motif,
  // y compris les formulations futures de la même famille.
  /hit your .{0,40}limit/i,
  /spend limit/i,
  /usage limit/i,
  /weekly limit/i,
  /monthly limit/i,
  /quota exceeded/i,
  /limite de d[ée]pense/i,
  /limite hebdomadaire/i,
];
// `☠ RETIRÉ LE 01/08 : `/rate limit/i`.` Jamais observé dans une annonce réelle
// du CLI — c'était un motif spéculatif, exactement ce que l'en-tête de ce
// fichier interdit. Et c'est la tournure la plus banale du métier : mesuré en
// production, l'orchestrateur décrivant StockIOP a écrit « Production readiness
// bouclée (rate limiting, security headers, structlog…) » et s'est déclaré
// saturé lui-même. Ne pas le rétablir en croyant à un trou de détection.

/**
 * `☠` Un AVERTISSEMENT n'est pas une saturation. « You've used 80% of your
 * five-hour limit » contient « limit » sans que rien ne soit atteint : le
 * traiter comme une saturation écarterait un compte encore parfaitement
 * utilisable (panne #16, déjà payée une fois côté workers).
 */
const MOTIFS_AVERTISSEMENT: readonly RegExp[] = [/you'?ve used \d+%/i, /approaching/i];

/**
 * `☠` Signature MACHINE de l'annonce du CLI, relevée sur les deux saturations
 * réelles (23/07 et 27/07) : `…claude.ai/settings/usage?from=cc_cli_limit_message`.
 * Ce paramètre de suivi est émis par le CLI, jamais écrit par un modèle qui
 * parle de quotas. C'est le seul indice certain, et il court-circuite toutes les
 * autres règles.
 */
const MARQUEUR_CLI = /cc_cli_limit_message/i;

/**
 * `☠ MESURÉ EN PRODUCTION LE 01/08.` Une annonce de saturation est un bloc
 * COURT et autonome — les deux vraies faisaient 102 caractères, message entier.
 * Le faux positif, lui, était un bloc de 2003 caractères où la tournure
 * apparaissait au milieu d'une phrase.
 *
 * D'où cette borne : au-delà, on est dans de la PROSE QUI PARLE de limites, pas
 * dans une machine qui en annonce une. Sans elle, ce détecteur lit le texte que
 * le modèle produit lui-même comme un signal de contrôle — et sur un projet dont
 * le sujet est justement les quotas d'API, il se déclenchait tout seul.
 *
 * `☠` Un bloc persisté EST un bloc complet : le streaming accumule dans
 * `#partiel` et n'écrit qu'à `content_block_stop` (`collecteur-conversation.ts`).
 * La borne porte donc bien sur un message entier, jamais sur un fragment.
 */
const LONGUEUR_MAX_ANNONCE = 400;

/** Le compte annonce-t-il une limite ATTEINTE ? Ni un avertissement, ni une supposition. */
export function annonceSaturation(texte: string): boolean {
  if (texte.length === 0) return false;
  if (MOTIFS_AVERTISSEMENT.some((m) => m.test(texte))) return false;
  // Signature machine : certitude, quelle que soit la longueur.
  if (MARQUEUR_CLI.test(texte)) return true;
  // `☠` Asymétrie des coûts, et c'est elle qui fixe le sens de ce filtre. Une
  // détection manquée coûte un message à renvoyer, avec l'annonce du CLI sous
  // les yeux. Un faux positif TUE la session, fait tourner le compte maître et
  // demande à l'opérateur de réécrire — pour un compte à 35 % (vécu le 01/08).
  if (texte.length > LONGUEUR_MAX_ANNONCE) return false;
  return MOTIFS_SATURATION.some((m) => m.test(texte));
}

/** Forme minimale d'un quota — évite de coupler cette règle au registre. */
export interface FenetreQuotaJugeable {
  readonly statut: string;
  /** Epoch ms de la fin de fenêtre. `null` = fin inconnue. */
  readonly resetA: number | null;
}

/**
 * Ce quota écarte-t-il ENCORE le compte ?
 *
 * `☠ VÉCU DU 26 AU 31/07` — un verdict de saturation ne survit pas à sa propre
 * fenêtre. La fenêtre hebdomadaire du compte A a été relevée `rejected` le 24/07
 * avec un reset au 26/07 ; la sonde n'ayant plus rien écrit depuis (429 sur
 * l'endpoint OAuth), ce `rejected` est resté en base. Cinq jours après la fin de
 * la fenêtre, `listerDisponibles()` et le choix du compte orchestrateur
 * écartaient toujours un compte parfaitement utilisable : la moitié de la
 * capacité perdue sur une mesure périmée que personne ne contredisait.
 *
 * Une fenêtre dont le reset est PASSÉ est finie — son verdict est caduc, quelle
 * que soit la fraîcheur de la mesure. C'est une déduction sur le temps, pas une
 * mesure : elle reste vraie même sonde muette, ce qui est exactement ce qu'il
 * fallait ici.
 *
 * `☠` Reset INCONNU (`null`) ⇒ le verdict tient. On ne relâche que sur une fin
 * de fenêtre établie, jamais sur une ignorance : écarter un compte sain coûte de
 * la capacité, en dispatcher un sur un compte mort coûte une mission.
 */
export function fenetreEncoreSaturante(
  quota: FenetreQuotaJugeable,
  maintenant: number = Date.now(),
): boolean {
  if (quota.statut !== 'rejected') return false;
  return quota.resetA === null || quota.resetA > maintenant;
}
