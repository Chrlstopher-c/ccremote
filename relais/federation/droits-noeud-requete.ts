// Responsabilité : les droits de la charte appliqués aux requêtes d'un pair — quel droit une requête exige, et la
// réponse négative à lui renvoyer. Fonctions pures : l'échange décide, journalise et envoie.
import { droitRequis, type RequeteDroit } from '../../commun/charte.ts';
import type { MessageChiffre } from '../../commun/federation.ts';

/** Le droit qu'une requête d'un pair exige (`geste ouvrir` = ouvrir une session), ou null si elle n'en exige pas. */
export function requeteDeMessage(m: MessageChiffre): RequeteDroit | null {
  if (m.t === 'geste') {
    return m.geste === 'ouvrir' ? { genre: 'ouvrir' } : { genre: 'geste', methode: m.methode, suffixe: m.geste };
  }
  if (m.t === 'fil' || m.t === 'ecrire' || m.t === 'interrompre' || m.t === 'ouvrir') return { genre: m.t };
  return null;
}

/** La réponse négative à une requête refusée : `geste_reponse` 403 pour un geste, `reponse` ok:false sinon. */
export function reponseRefusDroit(m: MessageChiffre, requete: RequeteDroit): MessageChiffre | null {
  const raison = `droit refusé : ${droitRequis(requete)}`;
  if (m.t === 'geste') {
    return { t: 'geste_reponse', ref: m.ref, statut: 403, corps: JSON.stringify({ erreur: raison }) };
  }
  return 'ref' in m ? { t: 'reponse', ref: m.ref, ok: false, raison } : null;
}

/** L'ami du duo au nom duquel la requête arrive, ou null (requête du pair seul). */
export function amiDeMessage(m: MessageChiffre): string | null {
  return 'ami' in m && m.ami !== undefined ? m.ami : null;
}

/**
 * Vrai si la requête reçue est permise : le pair relais doit l'avoir, et si elle vient au nom d'un ami du duo, la
 * machine visée (celle qui la reçoit) vérifie d'après la charte que l'ami a ce droit sur elle-même.
 */
export function requetePermise(
  message: MessageChiffre,
  requete: RequeteDroit,
  pairPermis: boolean,
  amiPermis: (ami: string, requete: RequeteDroit) => boolean,
): boolean {
  if (!pairPermis) return false;
  const ami = amiDeMessage(message);
  return ami === null || amiPermis(ami, requete);
}
