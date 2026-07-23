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
  /rate limit/i,
  /weekly limit/i,
  /monthly limit/i,
  /quota exceeded/i,
  /limite de d[ée]pense/i,
  /limite hebdomadaire/i,
];

/**
 * `☠` Un AVERTISSEMENT n'est pas une saturation. « You've used 80% of your
 * five-hour limit » contient « limit » sans que rien ne soit atteint : le
 * traiter comme une saturation écarterait un compte encore parfaitement
 * utilisable (panne #16, déjà payée une fois côté workers).
 */
const MOTIFS_AVERTISSEMENT: readonly RegExp[] = [/you'?ve used \d+%/i, /approaching/i];

/** Le compte annonce-t-il une limite ATTEINTE ? Ni un avertissement, ni une supposition. */
export function annonceSaturation(texte: string): boolean {
  if (texte.length === 0) return false;
  if (MOTIFS_AVERTISSEMENT.some((m) => m.test(texte))) return false;
  return MOTIFS_SATURATION.some((m) => m.test(texte));
}
