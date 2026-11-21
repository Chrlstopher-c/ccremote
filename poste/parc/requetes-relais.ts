// Responsabilité : les requêtes du poste au relais (outils de modules) — envoyées sur le lien ouvert, réponse rendue à
// leur id, délai borné. Relais hors ligne ou muet : erreur lisible, jamais une exception.
import { randomUUID } from 'node:crypto';
import type { QuoiRelais, ReponseRelais } from '../../commun/modules.ts';
import type { MessagePoste } from '../../commun/protocole-poste.ts';

// Le relais répond avant son propre délai (30 s) : au-delà, la réponse n'arrive plus.
export const DELAI_REQUETE_RELAIS_MS = 35_000;

export interface ParametresRequetes {
  readonly envoyer: (m: MessagePoste) => void;
  readonly estOuvert: () => boolean;
  readonly delaiMs?: number;
}

export class RequetesRelais {
  private readonly attentes = new Map<string, (r: ReponseRelais) => void>();

  constructor(private readonly p: ParametresRequetes) {}

  requete(quoi: QuoiRelais, args: unknown): Promise<ReponseRelais> {
    if (!this.p.estOuvert()) return Promise.resolve({ ok: false, erreur: 'relais injoignable : le lien est coupé' });
    const id = randomUUID();
    const delaiMs = this.p.delaiMs ?? DELAI_REQUETE_RELAIS_MS;
    return new Promise((resoudre) => {
      const minuteur = setTimeout(() => {
        this.attentes.delete(id);
        resoudre({ ok: false, erreur: `le relais n’a pas répondu dans le délai de ${Math.round(delaiMs / 1000)} s` });
      }, delaiMs);
      this.attentes.set(id, (r) => {
        clearTimeout(minuteur);
        this.attentes.delete(id);
        resoudre(r);
      });
      this.p.envoyer({ kind: 'requete_relais', id, quoi, args });
    });
  }

  /** Réponse du relais (`reponse_relais`) ; un id sans attente (délai échu) est ignoré. */
  recevoir(r: { readonly id: string } & ReponseRelais): void {
    this.attentes.get(r.id)?.({ ok: r.ok, donnees: r.donnees, erreur: r.erreur });
  }
}
