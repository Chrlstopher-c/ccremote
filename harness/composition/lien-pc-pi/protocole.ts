/**
 * Responsabilité : protocole applicatif multiplexé sur l'UNIQUE lien Pi↔PC
 * (H-75). `transport/lien-websocket.ts` (lecture seule, hors zone) fournit un
 * `Tuyau` d'octets opaques par sens (`versPc()`/`versPi()`) — pensé pour le
 * canal principal D.1 (stdin/stdout d'un worker). H-75 réutilise ce MÊME
 * mécanisme de reprise (reconnexion, backoff, ping/pong) pour porter, sur ce
 * lien unique, deux familles de messages qui n'existaient pas dans D.1 :
 *
 *  - `controle_requete` / `controle_reponse` (D.3, Pi→PC) : ce que portait
 *    jusqu'ici `superviseur/canal-controle.ts` sur son propre canal JSON.
 *
 * `☠` Ce lien portait aussi `permission_demande` / `permission_verdict`,
 * retirés le 2026-07-31 avec le bus d'escalade : en `permissionMode: 'auto'`
 * le SDK n'appelle jamais `canUseTool`, donc aucune demande n'a jamais
 * transité. Le trajet complet était bâti, câblé des deux côtés, et n'a rien
 * porté depuis le premier jour.
 *
 * `☠` LIMITE ASSUMÉE (voir rapport de mission, section « ce qui ne s'assemble
 * pas ») : ceci réutilise les tags `STDIN`/`STDOUT` de `trame.ts`, nommés et
 * documentés pour le protocole SDK stdin/stdout d'un worker (D.1, H-12), pour
 * transporter un protocole JSON structurellement différent. Le choix alternatif
 * — un tag `TAG.CONTROLE` dédié — exigerait de modifier `transport/trame.ts`
 * et `transport/lien-websocket.ts`, hors zone d'écriture de cette mission.
 * Chaque `ecrire()` porte EXACTEMENT une enveloppe JSON ; `CanalDonnees.recevoir`
 * délivre chaque trame reçue verbatim à ses abonnés (vérifié sur
 * `transport/canal-donnees.ts`), donc aucun framing supplémentaire (NDJSON,
 * longueur-préfixée) n'est nécessaire ici : un `ecrire()` == une enveloppe reçue.
 */

import type { RequeteControle, ReponseControle } from '../../superviseur/index.ts';
import type { Tuyau } from '../../transport/contrat.ts';

export type EnveloppeLien =
  | { readonly kind: 'controle_requete'; readonly id: string; readonly requete: RequeteControle }
  | { readonly kind: 'controle_reponse'; readonly id: string; readonly reponse: ReponseControle };

const encodeur = new TextEncoder();
const decodeur = new TextDecoder();

export class ErreurEnveloppeIllisible extends Error {
  constructor(cause: unknown) {
    super(`enveloppe du lien Pi↔PC illisible : ${String(cause)}`);
    this.name = 'ErreurEnveloppeIllisible';
  }
}

/** Émet une enveloppe sur le tuyau donné — un `ecrire()` == une enveloppe (voir en-tête). */
export function envoyerEnveloppe(tuyau: Tuyau, enveloppe: EnveloppeLien): void {
  tuyau.ecrire(encodeur.encode(JSON.stringify(enveloppe)));
}

/**
 * S'abonne aux enveloppes reçues sur le tuyau. Une trame illisible (JSON
 * corrompu) est signalée à `surErreur` plutôt que de faire planter le
 * process réseau — cohérent avec H-44/H-60 : jamais de crash silencieux, mais
 * jamais non plus d'exception qui remonte hors de la boucle réseau.
 */
export function surEnveloppe(tuyau: Tuyau, recevoir: (e: EnveloppeLien) => void, surErreur: (erreur: ErreurEnveloppeIllisible) => void): void {
  tuyau.surOctets((octets) => {
    try {
      const enveloppe = JSON.parse(decodeur.decode(octets)) as EnveloppeLien;
      recevoir(enveloppe);
    } catch (cause) {
      surErreur(new ErreurEnveloppeIllisible(cause));
    }
  });
}
