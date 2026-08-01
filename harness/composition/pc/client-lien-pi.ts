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
import { entetesMachine, normaliserMachineId } from '../lien-pc-pi/identite-machine.ts';
import { creerHorlogeAvecGigue } from './horloge-avec-gigue.ts';

const log = compositionLogger.child({ composant: 'client-lien-pi' });

export interface OptionsClientLienPi {
  /** `ws://` ou `wss://` du Pi, SANS le secret (ajouté ici). */
  readonly urlPi: string;
  readonly secret: string;
  /**
   * Identité de CETTE machine de travail, annoncée au Pi à chaque upgrade.
   *
   * `☠` C'est elle qui permet à plusieurs machines de cohabiter : côté Pi, le
   * supersede ne joue qu'à identité égale. Deux machines qui s'annonceraient
   * sous le même nom se chasseraient en boucle sans que rien ne le dise —
   * exactement la dette n°6. Elle est donc validée au démarrage (`bin-pc.ts`),
   * jamais devinée ici.
   */
  readonly machineId: string;
  /** Callback appelé sur toute fermeture TERMINALE (H-75 : jamais retentée en interne). */
  readonly surFermetureTerminale?: (fermeture: FermetureTerminale) => void;
}

/**
 * Délai au-delà duquel une connexion qui ne s'ouvre pas est traitée comme un
 * échec. Sans lui, un `SYN` avalé par un pare-feu (aucun refus, aucun paquet)
 * laisserait la promesse en suspens pour toujours : le lien resterait
 * silencieusement mort, sans jamais retenter.
 */
const DELAI_OUVERTURE_MS = 10_000;

/**
 * `☠ TROUVÉ EN CONDITION RÉELLE (2026-07-22, banc à deux machines)` — le
 * défaut que cette fonction corrige, et pourquoi aucun test ne pouvait le voir.
 *
 * `new WebSocket(url)` **ne rejette jamais** : le constructeur rend la main
 * immédiatement, la connexion se fait après. Un connecteur qui se contentait de
 * `Promise.resolve(new WebSocket(...))` réussissait donc TOUJOURS, y compris
 * serveur éteint. Dans `LienWebSocket.#tenterConnexion`, un succès remet
 * `#tentative` à zéro — donc le backoff repartait de son premier palier à
 * chaque essai et n'augmentait jamais.
 *
 * Mesuré avec le Pi éteint : **~2 tentatives par seconde, indéfiniment**, au
 * lieu d'une toutes les 10 s. Sur une nuit d'absence, ~57 000 requêtes à
 * travers le tunnel au lieu de ~3 000. Le backoff existait, il était testé, et
 * il ne protégeait rien — parce qu'en test le connecteur est une doublure qui
 * rejette proprement, là où le vrai `WebSocket` ne rejette pas.
 *
 * Corollaire aussi grave : `etat()` passait par `'ouvert'` à chaque tentative
 * ratée. C'est la source de `pcOnline` — l'interface aurait affirmé « PC en
 * ligne » par intermittence toute la nuit.
 *
 * D'où ce connecteur : il ne résout que sur `open` RÉEL, et rejette sinon.
 */
function connecterQuandVraimentOuvert(
  url: string,
  entetes: Record<string, string>,
  lien: () => LienWebSocket | null,
): Promise<WebSocket> {
  return new Promise((resoudre, rejeter) => {
    const ws = new WebSocket(url, { headers: entetes } as never);
    const minuterie = setTimeout(() => {
      ws.close();
      rejeter(new Error(`ouverture du lien non confirmée en ${DELAI_OUVERTURE_MS} ms`));
    }, DELAI_OUVERTURE_MS);

    // `☠` Un échec de connexion émet `error` PUIS `close` : sans ce verrou, les
    // deux régleraient la promesse et surtout planifieraient chacun une
    // reconnexion. Mesuré : les tentatives se multipliaient au lieu de
    // s'espacer. Une promesse ne se règle qu'une fois — le verrou le rend vrai
    // pour les EFFETS, pas seulement pour la valeur.
    let regle = false;
    const conclure = (action: () => void): void => {
      if (regle) return;
      regle = true;
      clearTimeout(minuterie);
      action();
    };
    ws.addEventListener('open', () => conclure(() => resoudre(ws)));
    ws.addEventListener('error', () => conclure(() => rejeter(new Error('échec de connexion au Pi'))));
    // `☠ SECOND DÉFAUT TROUVÉ EN CONDITION RÉELLE` — le serveur ferme en 4401
    // dans son propre handler `open`, si bien que côté client le `close` peut
    // précéder l'`open`. N'attendre que `open` faisait donc DISPARAÎTRE la
    // fermeture terminale : le secret refusé redevenait une coupure
    // transitoire, retentée sans fin et sans jamais nommer sa cause (mesuré :
    // le process ne sortait plus jamais). Le code brut est donc remis au
    // transport, seul détenteur de la taxonomie, AVANT de rejeter.
    ws.addEventListener('close', (ev) => {
      const { code, reason } = ev as unknown as { code: number; reason?: string };
      // Hors du verrou À DESSEIN : le classement d'un code terminal doit avoir
      // lieu même si `error` a déjà réglé la promesse — sinon l'ordre des
      // événements déciderait si un secret refusé est diagnostiqué ou non.
      // Cet appel est sans effet sur un code non terminal (voir sa doc).
      lien()?.signalerFermetureAvantOuverture(code, reason ?? '');
      conclure(() => rejeter(new Error(`lien fermé avant ouverture (code ${code})`)));
    });
  });
}

export function creerClientLienPi(options: OptionsClientLienPi): LienWebSocket {
  const urlJournalisable = urlSansSecret(options.urlPi);
  // `☠` Revalidée ici plutôt que supposée propre : ce module est aussi appelé
  // par les bancs et par `assembler-superviseur.ts`. Une identité refusée par
  // le Pi produit une fermeture 4403 terminale — mieux vaut échouer au
  // démarrage, avec la valeur fautive sous les yeux, qu'après un aller-retour.
  const machineId = normaliserMachineId(options.machineId);
  if (machineId === null) {
    throw new Error(
      `identité de machine invalide : « ${options.machineId} ». Attendu : minuscules, chiffres, « . _ - », 63 caractères max, commençant par une lettre ou un chiffre`,
    );
  }
  const entetes = { ...entetesAuth(options.secret), ...entetesMachine(machineId) };

  // Indirection par référence mutable : le connecteur doit pouvoir remettre au
  // lien une fermeture terminale, mais le lien n'existe pas encore quand on
  // construit ses options. Le connecteur n'est jamais appelé avant.
  let lienConstruit: LienWebSocket | null = null;

  const lien = new LienWebSocket({
    // `☠` Les en-têtes sont recomposés à CHAQUE tentative, pas capturés une
    // fois : le connecteur est rappelé à chaque reconnexion (H-75 — « tout
    // doit se reconnecter tout seul le lendemain »).
    connecter: () => connecterQuandVraimentOuvert(options.urlPi, entetes, () => lienConstruit),
    horloge: creerHorlogeAvecGigue(),
    modeIntegrite: 'perte_silencieuse',
  });

  lienConstruit = lien;

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

  log.info(
    { url: urlJournalisable, machineId },
    'client du lien Pi↔machine démarré — connexion sortante vers le Pi (H-75)',
  );
  return lien;
}
