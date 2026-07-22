/**
 * Responsabilité : authentification du lien Pi↔PC (H-75, point 2). Le point
 * d'écoute du Pi est joignable publiquement (Cloudflare Tunnel) — un secret
 * partagé, lu depuis l'environnement, jamais codé en dur, jamais journalisé.
 *
 * `☠` Comparaison à temps constant (`timingSafeEqual`) : un `===` sur un
 * secret laisse fuiter sa longueur/son préfixe par timing. Sans intérêt
 * pratique sur ce cas précis (secret long, attaquant distant sur un tunnel
 * HTTPS) mais sans coût non plus — pas de raison de s'en priver.
 */

import { timingSafeEqual } from 'node:crypto';

const CLE_PARAM_SECRET = 'secret';

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

/** Construit l'URL de connexion du PC vers le Pi, secret en paramètre de requête. */
export function urlAvecSecret(url: string, secret: string): string {
  const u = new URL(url);
  u.searchParams.set(CLE_PARAM_SECRET, secret);
  return u.toString();
}

/** Extrait le secret d'une requête HTTP d'upgrade WS entrante, côté Pi. */
export function extraireSecret(req: Request): string | null {
  return new URL(req.url).searchParams.get(CLE_PARAM_SECRET);
}

/** `☠` À utiliser PARTOUT où une URL de ce lien est journalisée — jamais l'URL brute. */
export function urlSansSecret(url: string): string {
  const u = new URL(url);
  u.searchParams.delete(CLE_PARAM_SECRET);
  return u.toString();
}
