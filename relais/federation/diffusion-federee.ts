// Responsabilité : ce que chaque changement local devient vis-à-vis des pairs — sessions (instantané groupé),
// événements, deltas de texte, confirmations de ce nœud. Ce qui vient d'un pair ne repart jamais : pas de boucle.
import type { MessageClient } from '../../commun/api-clients.ts';
import type { Canaux } from './canaux.ts';
import type { Distantes } from './distantes.ts';
import type { Echanges } from './echanges.ts';

export interface DestinatairesDiffusion {
  readonly distantes: Distantes;
  readonly echanges: Echanges;
  readonly canaux: Canaux;
}

export function surDiffusionFederee(m: MessageClient, d: DestinatairesDiffusion): void {
  const liens = (): ReturnType<Canaux['ouverts']> => d.canaux.ouverts();
  switch (m.type) {
    case 'flux':
      if (!d.distantes.estDistante(m.sessionId)) d.echanges.diffuserFlux(m, liens());
      return;
    case 'confirmation':
      if (!d.distantes.estConfirmationDistante(m.confirmation.id)) {
        d.echanges.diffuserConfirmation(m.confirmation, liens());
      }
      return;
    case 'session':
      if (d.distantes.estDistante(m.session.id)) return;
      d.echanges.programmerInstantane(liens);
      return;
    case 'supprimee':
      d.echanges.programmerInstantane(liens);
      return;
    case 'evenement': {
      const e = m.evenement;
      d.echanges.diffuserEvenement(e.sessionId, e.seq, e.ts, e.evt, liens());
      return;
    }
    default:
      return;
  }
}
