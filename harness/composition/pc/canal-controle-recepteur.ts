/**
 * Responsabilité : réception RÉELLE du canal de contrôle (D.3) côté PC, sur
 * le lien unique initié par le PC (H-75). Remplace `composition/pc/serveur-
 * controle.ts` (supprimé) — le PC n'héberge plus de serveur WebSocket propre
 * à D.3, il reçoit désormais des enveloppes `controle_requete` sur le MÊME
 * lien que celui utilisé pour dialer le Pi (`client-lien-pi.ts`).
 *
 * `☠` Respecte D.3.2 à la lettre malgré l'inversion du transport : ce module
 * ne fait jamais d'appel sortant de sa propre initiative — il ne fait que
 * RÉAGIR à une enveloppe reçue, exactement comme l'ancien serveur réagissait
 * à une connexion entrante. L'inversion porte sur QUI COMPOSE la connexion
 * physique (H-75), jamais sur qui décide des opérations (toujours le Pi).
 *
 * Utilise `versPi()` dans les deux sens (écrire ET lire) — voir `client-lien-
 * pi.ts` pour la limite mesurée sur `versPc()` (aucune réception câblée dans
 * `transport/lien-websocket.ts`, hors zone).
 */

import { CanalControle, type OptionsCanalControle, type PortSuperviseurControle, type RequeteControle } from '../../superviseur/index.ts';
import type { Lien } from '../../transport/contrat.ts';
import { compositionLogger } from '../logger.ts';
import { envoyerEnveloppe, surEnveloppe, type EnveloppeLien } from '../lien-pc-pi/protocole.ts';

const log = compositionLogger.child({ composant: 'canal-controle-recepteur-pc' });

export interface RecepteurControlePc {
  readonly canal: CanalControle;
}

/**
 * Câble `CanalControle` (D.3) sur les enveloppes `controle_requete` reçues
 * sur `lien`. `lien` DOIT être L'INSTANCE réelle partagée avec `client-lien-
 * pi.ts` — jamais une nouvelle instance.
 */
export function cablerRecepteurControlePc(
  superviseur: PortSuperviseurControle,
  lien: Lien,
  options: OptionsCanalControle = {},
): RecepteurControlePc {
  const canal = new CanalControle(superviseur, options);

  surEnveloppe(
    lien.versPi(),
    (enveloppe) => void traiterEnveloppe(canal, lien, enveloppe),
    (erreur) => log.error({ err: erreur }, 'enveloppe illisible reçue du Pi sur le lien de contrôle'),
  );

  return { canal };
}

function traiterEnveloppe(canal: CanalControle, lien: Lien, enveloppe: EnveloppeLien): Promise<void> {
  if (enveloppe.kind !== 'controle_requete') return Promise.resolve(); // `permission_verdict` : géré par port-bus-permissions-distant.ts.
  const requete: RequeteControle = enveloppe.requete;
  return canal
    .traiter(requete)
    .then((reponse) => envoyerEnveloppe(lien.versPi(), { kind: 'controle_reponse', id: enveloppe.id, reponse }))
    .catch((erreur: unknown) => {
      log.error({ err: erreur, opId: requete.opId }, 'traitement de la requête de contrôle en échec inattendu');
      envoyerEnveloppe(lien.versPi(), {
        kind: 'controle_reponse',
        id: enveloppe.id,
        reponse: { ok: false, effet: 'refuse', detail: 'échec inattendu côté PC' },
      });
    });
}
