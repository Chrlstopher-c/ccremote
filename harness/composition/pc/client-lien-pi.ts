/**
 * Responsabilité : le PC INITIE la connexion vers le Pi (H-75) — inversion de
 * `composition/pc/serveur-controle.ts` (l'ancien serveur PC, supprimé). Seul
 * point d'entrée réseau SORTANT du PC (H-75 : « le PC n'expose plus rien »).
 *
 * Reconnexion infinie, backoff exponentiel plafonné AVEC gigue (H-75, point
 * 3) : réutilise `LienWebSocket` tel quel (mandat : « ne réécris pas un
 * second mécanisme de reprise ») et lui injecte `creerHorlogeAvecGigue()` —
 * voir ce fichier pour la limite mesurée sur `backoffMs` (tableau fixe, pas
 * de gigue possible autrement sans modifier `transport/`, hors zone).
 *
 * `☠` Le secret (H-75, point 2) est lu depuis l'environnement UNE FOIS ici et
 * ne quitte jamais l'en-tête `Authorization` — il n'entre à aucun moment dans
 * l'URL, donc à aucun moment dans les access logs de Cloudflare Tunnel (voir
 * `lien-pc-pi/secret.ts`, défaut trouvé en relecture). L'URL reste
 * journalisable telle quelle ; `urlSansSecret` la nettoie par précaution.
 *
 * `☠ TROUVÉ EN ASSEMBLANT` — `modeIntegrite: 'perte_silencieuse'`, comme côté
 * Pi (`composition/pi/serveur-lien-pc.ts`, même en-tête pour le détail) :
 * `versPc()` n'a aucun chemin de réception câblé dans `transport/`, ce lien
 * n'utilise donc que `versPi()` dans les deux sens, qui n'est jamais rejoué
 * au rattachement — `'strict'` ferait lever une exception non rattrapée sur
 * le premier octet perdu pendant une coupure.
 */

import { LienWebSocket } from '../../transport/lien-websocket.ts';
import type { FermetureTerminale } from '../../transport/contrat.ts';
import { compositionLogger } from '../logger.ts';
import { entetesAuth, urlSansSecret } from '../lien-pc-pi/secret.ts';
import { creerHorlogeAvecGigue } from './horloge-avec-gigue.ts';

const log = compositionLogger.child({ composant: 'client-lien-pi' });

export interface OptionsClientLienPi {
  /** `ws://` ou `wss://` du Pi, SANS le secret (ajouté ici). */
  readonly urlPi: string;
  readonly secret: string;
  /** Callback appelé sur toute fermeture TERMINALE (H-75 : jamais retentée en interne). */
  readonly surFermetureTerminale?: (fermeture: FermetureTerminale) => void;
}

export function creerClientLienPi(options: OptionsClientLienPi): LienWebSocket {
  const urlJournalisable = urlSansSecret(options.urlPi);
  const entetes = entetesAuth(options.secret);

  const lien = new LienWebSocket({
    // `☠` Les en-têtes sont recomposés à CHAQUE tentative, pas capturés une
    // fois : le connecteur est rappelé à chaque reconnexion (H-75 — « tout
    // doit se reconnecter tout seul le lendemain »).
    connecter: () => Promise.resolve(new WebSocket(options.urlPi, { headers: entetes }) as unknown as WebSocket),
    horloge: creerHorlogeAvecGigue(),
    modeIntegrite: 'perte_silencieuse',
  });

  lien.surFermeture((fermeture) => {
    // `☠` H-75 : une fermeture terminale (ex. 4401, secret invalide) n'est
    // JAMAIS retentée par `LienWebSocket` lui-même — c'est la propriété
    // recherchée. La reprise après une VRAIE cause définitive (mauvais
    // secret dans l'environnement) devient une décision humaine (corriger
    // `.env`) suivie d'un redémarrage du service — jamais un martèlement
    // silencieux du Pi. `Restart=always` de systemd (voir composition/
    // deploiement/) redémarre le PROCESS après un délai, pas la connexion :
    // une nouvelle tentative n'a lieu qu'après un redémarrage complet.
    log.error({ fermeture, url: urlJournalisable }, 'fermeture terminale du lien PC→Pi — aucune reconnexion automatique');
    options.surFermetureTerminale?.(fermeture);
  });

  log.info({ url: urlJournalisable }, 'client du lien Pi↔PC démarré — connexion sortante vers le Pi (H-75)');
  return lien;
}
