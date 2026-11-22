// Responsabilité : les réponses attendues par le demandeur sur le lien — chaque requête porte un identifiant et attend
// sa réponse. Le pair peut d'abord annoncer qu'il demande l'accord de Chris (`attente`) : la requête reste ouverte
// jusqu'à la réponse finale. Sans réponse dans le délai, ou lien coupé, la réponse finale est `null` (refus côté appelant).
import type { MessageLien } from '../../commun/duo.ts';

export interface Suivi {
  /** Le pair demande l'accord de Chris, sous cette demande. Appelé au plus une fois ; la requête reste ouverte. */
  readonly attente: (demande: string) => void;
  /** Réponse finale du pair, ou `null` sans réponse dans le délai (ou lien coupé). */
  readonly fin: (m: MessageLien | null) => void;
}

interface Entree {
  readonly suivi: Suivi;
  readonly minuterie: ReturnType<typeof setTimeout>;
}

export class Attentes {
  private readonly en = new Map<string, Entree>();

  /** Envoie la requête par `envoyer` (faux si le lien est absent) et suit ses réponses jusqu'à la finale. */
  suivre(
    ref: string,
    message: MessageLien,
    envoyer: (m: MessageLien) => boolean,
    delaiMs: number,
    suivi: Suivi,
  ): void {
    const minuterie = setTimeout(() => this.clore(ref, null), delaiMs);
    this.en.set(ref, { suivi, minuterie });
    if (!envoyer(message)) this.clore(ref, null);
  }

  /** Envoie la requête et attend sa réponse finale, sans annonce d'attente. */
  requete(
    ref: string,
    message: MessageLien,
    envoyer: (m: MessageLien) => boolean,
    delaiMs: number,
  ): Promise<MessageLien | null> {
    return new Promise((rendre) =>
      this.suivre(ref, message, envoyer, delaiMs, { attente: () => undefined, fin: rendre }),
    );
  }

  recevoir(ref: string, m: MessageLien): void {
    const entree = this.en.get(ref);
    if (!entree) return;
    if (m.type === 'attente') return entree.suivi.attente(m.demande);
    this.clore(ref, m);
  }

  annuler(): void {
    for (const ref of [...this.en.keys()]) this.clore(ref, null);
  }

  private clore(ref: string, m: MessageLien | null): void {
    const entree = this.en.get(ref);
    if (!entree) return;
    clearTimeout(entree.minuterie);
    this.en.delete(ref);
    entree.suivi.fin(m);
  }
}
