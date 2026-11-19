// Responsabilité : la liste des connecteurs de chaque machine, gardée jusqu'à un changement ou 10 minutes. Une liste
// gardée part tout de suite, avec sa fraîcheur, pendant qu'une relecture la remet à jour en arrière-plan.
import type { Logger } from 'pino';
import type { ConnecteurMachine } from '../../commun/configuration.ts';

export const DUREE_CACHE_CONNECTEURS_MS = 10 * 60_000;

export interface ListeConnecteurs {
  readonly connecteurs: ConnecteurMachine[];
  readonly fraicheur: string; // ISO : moment où la liste a été relue sur le poste
}

export type ResultatListe =
  { readonly ok: true; readonly valeur: ListeConnecteurs } | { readonly ok: false; readonly erreur: string };

type Relue =
  { readonly ok: true; readonly connecteurs: ConnecteurMachine[] } | { readonly ok: false; readonly erreur: string };
type Relecture = (machine: string) => Promise<Relue>;
interface Entree {
  readonly quand: number;
  readonly connecteurs: ConnecteurMachine[];
}
interface EnCours {
  readonly generation: number;
  readonly promesse: Promise<ResultatListe>;
}

export class CacheConnecteurs {
  private readonly entrees = new Map<string, Entree>();
  private readonly enCours = new Map<string, EnCours>();
  // Un changement (invalidation) fait partie des lectures : une relecture partie avant ne remplit pas le cache.
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly relire: Relecture,
    private readonly journal: Logger,
    private readonly maintenant: () => number = Date.now,
  ) {}

  /** Liste gardée si elle a moins de 10 minutes (relecture en arrière-plan), sinon relue sur le poste. */
  async lire(machine: string): Promise<ResultatListe> {
    const entree = this.entrees.get(machine);
    if (entree && this.maintenant() - entree.quand < DUREE_CACHE_CONNECTEURS_MS) {
      void this.rafraichir(machine);
      return { ok: true, valeur: valeurDe(entree) };
    }
    return this.rafraichir(machine);
  }

  /** Tout changement de connecteur de la machine : la prochaine lecture repart du poste. */
  invalider(machine: string): void {
    this.entrees.delete(machine);
    this.generations.set(machine, this.generation(machine) + 1);
  }

  private generation(machine: string): number {
    return this.generations.get(machine) ?? 0;
  }

  private rafraichir(machine: string): Promise<ResultatListe> {
    const generation = this.generation(machine);
    const en = this.enCours.get(machine);
    if (en && en.generation === generation) return en.promesse;
    const promesse = this.relireSur(machine).then((r) => this.memoriser(machine, generation, r));
    this.enCours.set(machine, { generation, promesse });
    return promesse;
  }

  private memoriser(machine: string, generation: number, r: Relue): ResultatListe {
    if (this.enCours.get(machine)?.generation === generation) this.enCours.delete(machine);
    if (!r.ok) {
      this.journal.warn({ machine, erreur: r.erreur }, 'connecteurs de la machine non relus');
      return r;
    }
    const entree: Entree = { quand: this.maintenant(), connecteurs: r.connecteurs };
    if (this.generation(machine) === generation) this.entrees.set(machine, entree);
    return { ok: true, valeur: valeurDe(entree) };
  }

  private async relireSur(machine: string): Promise<Relue> {
    try {
      return await this.relire(machine);
    } catch (erreur) {
      this.journal.warn({ err: erreur, machine }, 'relecture des connecteurs impossible');
      return { ok: false, erreur: 'relecture des connecteurs impossible' };
    }
  }
}

function valeurDe(entree: Entree): ListeConnecteurs {
  return { connecteurs: entree.connecteurs, fraicheur: new Date(entree.quand).toISOString() };
}
