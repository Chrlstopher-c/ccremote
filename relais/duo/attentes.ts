// Responsabilité : les réponses attendues par le demandeur sur le lien — chaque requête porte un identifiant et attend
// sa réponse ; sans réponse dans le délai, ou lien coupé, elle rend `null` (refus côté appelant).
import type { MessageLien } from '../../commun/duo.ts';

type Fin = (m: MessageLien | null) => void;

export class Attentes {
  private readonly en = new Map<string, Fin>();

  /** Envoie la requête par `envoyer` (faux si le lien est absent) et attend sa réponse. */
  requete(
    ref: string,
    message: MessageLien,
    envoyer: (m: MessageLien) => boolean,
    delaiMs: number,
  ): Promise<MessageLien | null> {
    return new Promise((rendre) => {
      const minuterie = setTimeout(() => this.clore(ref, null), delaiMs);
      this.en.set(ref, (m) => {
        clearTimeout(minuterie);
        rendre(m);
      });
      if (!envoyer(message)) this.clore(ref, null);
    });
  }

  recevoir(ref: string, m: MessageLien): void {
    this.clore(ref, m);
  }

  annuler(): void {
    for (const ref of [...this.en.keys()]) this.clore(ref, null);
  }

  private clore(ref: string, m: MessageLien | null): void {
    const fin = this.en.get(ref);
    if (!fin) return;
    this.en.delete(ref);
    fin(m);
  }
}
