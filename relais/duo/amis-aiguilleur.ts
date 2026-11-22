// Responsabilité : l'aiguilleur de tous les emplacements d'amis — un seul lien de la fédération pour le nœud. Chaque
// emplacement envoie par un port qui note les canaux qu'il ouvre ; une ouverture entrante va à l'emplacement qui la
// reconnaît (le lien de son pair, sinon celui qui attend un appairage) ; les autres messages vont à celui qui possède
// le canal. Ne décide d'aucun droit : c'est le nœud qui reçoit la demande qui l'applique.
import type { Logger } from 'pino';
import type { MessageDeAiguilleur, MessageVersAiguilleur } from '../../commun/aiguilleur.ts';
import type { HandlerDuoAiguilleur, PortAiguilleurDuo } from '../../commun/duo-aiguilleur.ts';
import type { LiaisonAiguilleur } from './liaison-aiguilleur.ts';

interface Branchement {
  readonly id: string;
  readonly liaison: LiaisonAiguilleur;
}

export class MultiplexeurAiguilleur implements HandlerDuoAiguilleur {
  private readonly branchements = new Map<string, Branchement>();
  private readonly proprietaires = new Map<string, string>(); // canal → emplacement

  constructor(
    private readonly port: PortAiguilleurDuo,
    private readonly journal: Logger,
  ) {}

  /** Le port d'un emplacement : ses envois passent par le lien commun, et ses canaux ouverts sont notés. */
  portPour(id: string): PortAiguilleurDuo {
    return {
      membreLocal: () => this.port.membreLocal(),
      identiteLocale: () => this.port.identiteLocale(),
      envoyer: (m) => this.envoyer(id, m),
      enLigne: (membre) => this.port.enLigne(membre),
      relie: () => this.port.relie(),
    };
  }

  ajouter(branchement: Branchement): void {
    this.branchements.set(branchement.id, branchement);
  }

  /** Un emplacement suspendu ou retiré n'accepte plus aucun canal. */
  retirer(id: string): void {
    this.branchements.delete(id);
    for (const [canal, proprietaire] of [...this.proprietaires]) {
      if (proprietaire === id) this.proprietaires.delete(canal);
    }
  }

  surConnexion(connecte: boolean): void {
    for (const { liaison } of this.branchements.values()) liaison.surConnexion(connecte);
  }

  surMessage(message: MessageDeAiguilleur): void {
    if (message.t === 'presence') return;
    if (message.t === 'ouvrir') return this.accueillir(message.canal, message.de);
    const canal = message.canal;
    const id = canal === undefined ? undefined : this.proprietaires.get(canal);
    const branchement = id === undefined ? undefined : this.branchements.get(id);
    if (canal === undefined || branchement === undefined) {
      return this.journal.warn({ canal, t: message.t }, 'duo : canal inconnu');
    }
    branchement.liaison.surMessage(message);
    if (message.t === 'fermer' || message.t === 'refuser') this.proprietaires.delete(canal);
  }

  // Une ouverture entrante va à l'emplacement qui la reconnaît ; sinon elle est refusée tout de suite.
  private accueillir(canal: string, de: string): void {
    const branchement = this.choisir(de);
    if (branchement === null || this.proprietaires.has(canal)) {
      this.journal.warn({ de }, 'duo : ouverture refusée');
      this.port.envoyer({ t: 'refuser', canal });
      return;
    }
    this.proprietaires.set(canal, branchement.id);
    branchement.liaison.surMessage({ t: 'ouvrir', canal, de });
  }

  // Le lien confirmé d'abord ; à défaut, l'emplacement qui attend un appairage.
  private choisir(de: string): Branchement | null {
    let appairage: Branchement | null = null;
    for (const branchement of this.branchements.values()) {
      const intention = branchement.liaison.intentionEntrante(de);
      if (intention === 'lien') return branchement;
      if (intention === 'appairage') appairage ??= branchement;
    }
    return appairage;
  }

  private envoyer(id: string, message: MessageVersAiguilleur): boolean {
    if (message.t === 'ouvrir') this.proprietaires.set(message.canal, id);
    if (message.t === 'fermer' || message.t === 'refuser') this.proprietaires.delete(message.canal);
    const envoye = this.port.envoyer(message);
    if (!envoye && message.t === 'ouvrir') this.proprietaires.delete(message.canal);
    return envoye;
  }
}
