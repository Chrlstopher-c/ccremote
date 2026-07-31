/**
 * Responsabilité : groupe « fil » de la surface d'outils — l'orchestrateur nomme
 * la conversation dans laquelle il parle.
 *
 * `☠` Borné à LA conversation appelante : `conversationId` vient de la closure du
 * serveur, jamais d'un paramètre du modèle. Il ne peut donc pas renommer le fil
 * d'à côté, même en devinant son identifiant.
 *
 * ☠ Aucune fonction ici ne laisse fuir d'exception (contrat A.2.4).
 */

import type { Registre } from '../../registre/index.ts';
import { verdictNommage } from '../titre-fil.ts';
import { applique, echecInattendu, refuse } from './contrat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import type { ContratRetour } from './types.ts';

const SANS_FIL = 'cette session n’est rattachée à aucune conversation : il n’y a rien à nommer';

/**
 * Messages de Chris déjà écrits dans ce fil.
 *
 * `☠` Compté sur les évènements persistés, pas sur un compteur en mémoire : la
 * session de l'orchestrateur redémarre (compaction, reprise, redéploiement) et un
 * compteur vivant repartirait de zéro — le fil se ferait renommer une deuxième
 * fois, avec un titre tiré du milieu de la conversation.
 */
function messagesOperateur(registre: Registre, conversationId: string): number {
  return registre.conversations.evenements(conversationId).filter((e) => e.type === 'operateur').length;
}

export function nommerFil(
  registre: Registre,
  conversationId: string | null,
  titreBrut: string,
  demandeParChris: boolean,
): ContratRetour {
  const intention = `nommer ce fil « ${titreBrut} »`;
  try {
    if (conversationId === null) return refuse(intention, SANS_FIL);
    const conv = registre.conversations.lire(conversationId);
    if (conv === null) return refuse(intention, SANS_FIL);

    const verdict = verdictNommage(
      { source: conv.titreSource, messagesOperateur: messagesOperateur(registre, conversationId) },
      titreBrut,
      demandeParChris,
    );
    // `☠` Refus AVANT toute écriture : un titre à moitié posé sur un fil dont la
    // source n'a pas bougé laisserait un état à réconcilier, pire qu'un refus net.
    if (!verdict.ok) return refuse(intention, verdict.raison ?? 'nommage refusé');

    const titre = verdict.titre ?? '';
    const source = demandeParChris ? 'manuel' : 'auto';
    if (!registre.conversations.renommer(conversationId, titre, source)) {
      return refuse(intention, 'la conversation a disparu entre la vérification et l’écriture');
    }
    journal.info({ conversationId, titre, source }, 'fil nommé');
    return applique(
      intention,
      demandeParChris
        ? `fil renommé « ${titre} » à la demande de Chris`
        : `fil nommé « ${titre} » — c'est son titre pour toute la session, ne le change plus de toi-même`,
      conversationId,
    );
  } catch (erreur) {
    return echecInattendu(intention, erreur);
  }
}
