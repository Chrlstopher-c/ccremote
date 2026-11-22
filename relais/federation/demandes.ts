// Responsabilité : les demandes d'appairage qui attendent la décision de Chris sur ce nœud — une par nouveau nœud, avec
// l'empreinte de sa clé et celle de la nôtre. Sans réponse dans le délai, elle est refusée. Rien n'est persisté.
import { nonceRef } from './identifiants.ts';

export interface DemandeAppairage {
  readonly id: string;
  /** Le membre qui demande. Absent pour une demande vue chez un autre nœud (la photo ne le transmet pas). */
  readonly membre?: string;
  readonly nom: string;
  readonly empreinte: string;
  readonly empreinteLocale: string;
  /** Identité publique du demandeur (un téléphone la lit pour retrouver le membre de la charte). */
  readonly identite?: string;
  /** Nœud ou appareil client : Chris le voit avant d'accorder. */
  readonly genre: 'noeud' | 'appareil';
  readonly le: string;
  /** Nœud qui tient la demande, quand elle n'est pas locale : la décision lui est relayée. */
  readonly noeud?: string;
}

export type DonneesDemande = Omit<DemandeAppairage, 'id' | 'le' | 'membre' | 'noeud'> & { readonly membre: string };

interface Attente {
  readonly demande: DemandeAppairage;
  readonly decider: (accord: boolean) => void;
  readonly minuterie: ReturnType<typeof setTimeout>;
}

export class DemandesAppairage {
  private readonly en = new Map<string, Attente>();

  constructor(
    private readonly delaiMs: number,
    private readonly horloge: () => number,
  ) {}

  /** Enregistre une demande ; `decider` reçoit la décision (accord, refus ou expiration = refus). */
  ajouter(donnees: DonneesDemande, decider: (accord: boolean) => void): DemandeAppairage {
    const demande: DemandeAppairage = { ...donnees, id: nonceRef(), le: new Date(this.horloge()).toISOString() };
    const minuterie = setTimeout(() => this.trancher(demande.id, false), this.delaiMs);
    this.en.set(demande.id, { demande, decider, minuterie });
    return demande;
  }

  lister(): DemandeAppairage[] {
    return [...this.en.values()].map((a) => a.demande);
  }

  /** Faux si la demande n'existe pas (déjà tranchée ou expirée). */
  decider(id: string, accord: boolean): boolean {
    return this.trancher(id, accord);
  }

  /** Retire les demandes d'un membre dont le canal a disparu : plus rien à trancher. */
  retirerPour(membre: string): void {
    for (const [id, a] of [...this.en]) if (a.demande.membre === membre) this.nettoyer(id);
  }

  arreter(): void {
    for (const id of [...this.en.keys()]) this.trancher(id, false);
  }

  private trancher(id: string, accord: boolean): boolean {
    const attente = this.en.get(id);
    if (!attente) return false;
    this.nettoyer(id);
    attente.decider(accord);
    return true;
  }

  private nettoyer(id: string): void {
    const attente = this.en.get(id);
    if (!attente) return;
    clearTimeout(attente.minuterie);
    this.en.delete(id);
  }
}
