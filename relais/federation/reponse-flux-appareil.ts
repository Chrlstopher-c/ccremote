// Responsabilité : une réponse de l'API clients en flux, envoyée à un appareil dans son canal chiffré. En-tête
// (`api_flux`), morceaux base64 au fil de l'arrivée des octets (`morceau`, même référence, rangs dans l'ordre), puis
// `api_fin` qui annonce leur nombre. Un morceau tient dans une trame d'appareil ; une coupure en route se signale par
// `api_fin` ok=faux : l'appareil ne rend jamais un flux tronqué comme complet.
import type { Logger } from 'pino';
import {
  type MessageChiffre,
  NOMBRE_MAX_MORCEAUX_APPAREIL,
  TAILLE_MORCEAU_APPAREIL_CARACTERES,
} from '../../commun/federation.ts';

/** Octets bruts par morceau : leur base64 tient exactement dans un morceau d'appareil, sans remplissage au milieu. */
export const OCTETS_MORCEAU_FLUX = (TAILLE_MORCEAU_APPAREIL_CARACTERES / 4) * 3;

export interface ReponseFluxAppareil {
  readonly statut: number;
  readonly type?: string;
  readonly flux: ReadableStream<Uint8Array>;
}

/** Envoie la réponse en flux ; `envoyer` rend faux si le canal ne part plus, et le flux amont est alors relâché. */
export async function envoyerReponseFlux(
  envoyer: (message: MessageChiffre) => boolean,
  ref: string,
  reponse: ReponseFluxAppareil,
  journal: Logger,
): Promise<void> {
  if (!envoyer({ t: 'api_flux', ref, statut: reponse.statut, ...(reponse.type ? { type: reponse.type } : {}) })) return;
  let rang = 0;
  try {
    for await (const bloc of reponse.flux) {
      for (let debut = 0; debut < bloc.byteLength; debut += OCTETS_MORCEAU_FLUX) {
        if (rang >= NOMBRE_MAX_MORCEAUX_APPAREIL) throw new Error('flux trop long pour le canal');
        const tranche = Buffer.from(bloc.subarray(debut, debut + OCTETS_MORCEAU_FLUX)).toString('base64');
        if (!envoyer({ t: 'morceau', ref, rang, corps: tranche })) throw new Error('canal fermé pendant le flux');
        rang += 1;
      }
    }
    envoyer({ t: 'api_fin', ref, morceaux: rang, ok: true });
  } catch (erreur) {
    journal.error({ err: erreur, ref }, 'appareil : flux de réponse interrompu');
    envoyer({ t: 'api_fin', ref, morceaux: rang, ok: false });
  }
}
