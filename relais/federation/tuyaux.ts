// Responsabilité : le choix du tuyau d'un message du protocole — la liaison directe avec le membre si elle est ouverte,
// sinon l'aiguilleur. Un canal reste sur le tuyau qui l'a ouvert (un canal ne change jamais de chemin en route). Les
// canaux du duo passent toujours par l'aiguilleur : le duo relie deux propriétaires. Rien n'est lu ni décidé ici.
import type { MessageVersAiguilleur } from '../../commun/aiguilleur.ts';
import { estCanalDuo } from '../../commun/duo-aiguilleur.ts';

export interface PortTuyaux {
  envoyerAiguilleur(message: MessageVersAiguilleur): boolean;
  /** Envoi sur la liaison directe ouverte avec ce membre ; null s'il n'y en a pas. */
  envoyerDirect(membre: string, message: MessageVersAiguilleur): boolean | null;
}

export class Tuyaux {
  // Canal -> membre de la liaison directe qui le porte. Un canal absent passe par l'aiguilleur.
  private readonly parCanal = new Map<string, string>();

  constructor(private readonly port: PortTuyaux) {}

  envoyer(message: MessageVersAiguilleur): boolean {
    if (message.t === 'ouvrir') return this.ouvrir(message.canal, message.vers, message);
    const membre = this.parCanal.get(message.canal);
    const envoye =
      membre === undefined ? this.port.envoyerAiguilleur(message) : (this.port.envoyerDirect(membre, message) ?? false);
    if (message.t === 'fermer') this.parCanal.delete(message.canal);
    return envoye;
  }

  /** Un canal ouvert par un pair sur sa liaison directe : ses réponses reprennent cette liaison. */
  ouvertParPair(canal: string, membre: string): void {
    this.parCanal.set(canal, membre);
  }

  /** Le canal est fermé (des deux côtés) : son tuyau est oublié. */
  oublier(canal: string): void {
    this.parCanal.delete(canal);
  }

  private ouvrir(canal: string, membre: string, message: MessageVersAiguilleur): boolean {
    if (!estCanalDuo(canal) && this.port.envoyerDirect(membre, message) === true) {
      this.parCanal.set(canal, membre);
      return true;
    }
    return this.port.envoyerAiguilleur(message);
  }
}
