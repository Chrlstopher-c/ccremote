/**
 * Responsabilité : authentification du lien Pi↔PC (H-75, point 2). Le point
 * d'écoute du Pi est joignable publiquement (Cloudflare Tunnel) — un secret
 * partagé, lu depuis l'environnement, jamais codé en dur, jamais journalisé.
 *
 * `☠ TROUVÉ EN RELECTURE (2026-07-22)` — le secret transitait d'abord en
 * PARAMÈTRE DE REQUÊTE (`?secret=…`). Nos propres logs étaient bien propres
 * (`urlSansSecret`), mais un secret en query-string est journalisé par tout ce
 * qui se trouve sur le chemin **et que nous ne contrôlons pas** : les access
 * logs de Cloudflare Tunnel en premier lieu, exactement l'intermédiaire que
 * cette architecture impose. Un secret partagé de longue durée déposé en clair
 * dans les logs d'un tiers, c'est la fuite que H-75 point 2 cherchait à éviter.
 * Il voyage désormais dans l'en-tête `Authorization: Bearer …` — jamais dans
 * l'URL, donc jamais dans un access log. Mesuré avant d'être écrit : le client
 * WebSocket de Bun accepte bien `{ headers }` en second argument.
 *
 * `☠` Comparaison à temps constant (`timingSafeEqual`) : un `===` sur un
 * secret laisse fuiter sa longueur/son préfixe par timing. Sans intérêt
 * pratique sur ce cas précis (secret long, attaquant distant sur un tunnel
 * HTTPS) mais sans coût non plus — pas de raison de s'en priver.
 */

import { timingSafeEqual } from 'node:crypto';

const PREFIXE_BEARER = 'Bearer ';

/** `true` seulement si `fourni` est défini ET égal, en temps constant, à `attendu`. */
export function secretValide(fourni: string | null, attendu: string): boolean {
  if (fourni === null || fourni.length === 0) return false;
  const bufFourni = Buffer.from(fourni);
  const bufAttendu = Buffer.from(attendu);
  // `timingSafeEqual` exige des buffers de même longueur — une longueur
  // différente est déjà un rejet, sans fuite utile (le secret attendu n'a pas
  // de longueur secrète en soi, seul son CONTENU l'est).
  if (bufFourni.length !== bufAttendu.length) return false;
  return timingSafeEqual(bufFourni, bufAttendu);
}

/**
 * En-têtes d'authentification à passer au client WebSocket du PC.
 * `☠` Le secret ne doit JAMAIS repartir dans l'URL — voir l'en-tête de fichier.
 */
export function entetesAuth(secret: string): Record<string, string> {
  return { authorization: `${PREFIXE_BEARER}${secret}` };
}

/** Extrait le secret d'une requête HTTP d'upgrade WS entrante, côté Pi. */
export function extraireSecret(req: Request): string | null {
  const entete = req.headers.get('authorization');
  if (entete === null || !entete.startsWith(PREFIXE_BEARER)) return null;
  return entete.slice(PREFIXE_BEARER.length);
}

/**
 * `☠` À utiliser PARTOUT où une URL de ce lien est journalisée. L'URL ne porte
 * plus le secret, mais elle peut porter d'autres paramètres, et le filet reste
 * utile si quelqu'un en rajoute un : tout paramètre de requête est retiré.
 */
export function urlSansSecret(url: string): string {
  const u = new URL(url);
  u.search = '';
  return u.toString();
}
