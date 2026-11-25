// Responsabilité : mémoire des refus de dépôt git (« hors dépôt git », « aucune branche de base ») par session et
// dossier. Un dossier hors dépôt ne le devient pas à chaque mise à jour du fil : le refus est gardé quelques
// minutes, puis redemandé à git.
import { estRefusDepot } from '../../commun/modifications.ts';

const DUREE_MS = 5 * 60_000;

interface Refus {
  readonly cwd: string;
  readonly erreur: string;
  readonly jusqua: number;
}

export class RefusDepot {
  private readonly refus = new Map<string, Refus>();

  constructor(private readonly maintenant: () => number = Date.now) {}

  /** Le refus déjà connu pour cette session et ce dossier, ou null (à redemander à git). */
  pour(sessionId: string, cwd: string): string | null {
    const connu = this.refus.get(sessionId);
    if (!connu) return null;
    if (connu.cwd !== cwd || connu.jusqua <= this.maintenant()) {
      this.refus.delete(sessionId);
      return null;
    }
    return connu.erreur;
  }

  /** Retient un refus de dépôt ; toute autre erreur ou réussite efface le refus précédent de la session. */
  noter(sessionId: string, cwd: string, erreur: string | null): void {
    if (erreur === null || !estRefusDepot(erreur)) {
      this.refus.delete(sessionId);
      return;
    }
    this.refus.set(sessionId, { cwd, erreur, jusqua: this.maintenant() + DUREE_MS });
  }

  oublier(sessionId: string): void {
    this.refus.delete(sessionId);
  }
}
