// Responsabilité : ce que chaque changement local devient vis-à-vis des pairs — sessions (instantané groupé),
// événements, deltas de texte, confirmations de ce nœud. Ce qui vient d'un pair ne repart jamais : pas de boucle.
// Seuls les liens vers des NŒUDS reçoivent ces messages : un appareil (iPhone) a son propre flux
// (appareil-diffusion.ts) et ferme son canal sur un message de fédération qu'il ne connaît pas.
import type { MessageClient } from '../../commun/api-clients.ts';
import type { CanalNoeud } from './canal.ts';
import type { Distantes } from './distantes.ts';
import type { Echanges } from './echanges.ts';

export interface DestinatairesDiffusion {
  readonly distantes: Distantes;
  readonly echanges: Echanges;
  /** Les liens ouverts vers des nœuds pairs (jamais vers un appareil). */
  readonly liensPairs: () => readonly CanalNoeud[];
}

export function surDiffusionFederee(m: MessageClient, d: DestinatairesDiffusion): void {
  const liens = d.liensPairs;
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
