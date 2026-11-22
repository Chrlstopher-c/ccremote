// Responsabilité : l'état des machines entre nœuds appariés — envoi à l'ouverture d'un lien puis périodique, réception
// (dernier état gardé par membre, MAC du pair apprise pour le réveil). Les cibles sont données par l'appelant : jamais
// un appareil. Rien ne va dans le registre.
import type { Logger } from 'pino';
import type { EtatNoeud, MessageChiffre } from '../../commun/federation.ts';
import type { ReseauxConnus } from '../entretien/reseaux.ts';

/** Ce que l'échange utilise d'un lien : le pair et l'envoi (un canal de la fédération le permet). */
export interface CanalEtat {
  readonly membre: string;
  envoyer(message: MessageChiffre): boolean;
}

export const INTERVALLE_ETAT_MS = 20_000;

export interface DependancesEchangeEtat {
  readonly mesurer: () => Promise<EtatNoeud>;
  readonly reseaux?: ReseauxConnus;
  /** Identifiant de machine d'un pair (celui de son instantané), ou null tant qu'il n'est pas connu. */
  readonly machineDe: (membre: string) => string | null;
  readonly journal: Logger;
  readonly intervalleMs?: number;
}

export class EtatsNoeud {
  private readonly recus = new Map<string, EtatNoeud>();
  private minuterie: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly d: DependancesEchangeEtat) {}

  /** Envoi périodique aux liens rendus par `cibles` (les nœuds reliés) ; un tour sans lien ne mesure rien. */
  demarrer(cibles: () => readonly CanalEtat[]): void {
    this.arreter();
    this.minuterie = setInterval(() => void this.envoyer(cibles()), this.d.intervalleMs ?? INTERVALLE_ETAT_MS);
  }

  arreter(): void {
    if (this.minuterie) clearInterval(this.minuterie);
    this.minuterie = null;
  }

  /** À l'ouverture d'un lien : l'état part dès qu'il est mesuré, après les instantanés déjà envoyés. */
  async envoyerA(canal: CanalEtat): Promise<void> {
    await this.envoyer([canal]);
  }

  private async envoyer(liens: readonly CanalEtat[]): Promise<void> {
    if (liens.length === 0) return;
    try {
      const etat = await this.d.mesurer();
      for (const lien of liens) lien.envoyer({ t: 'etat_noeud', etat });
    } catch (erreur) {
      this.d.journal.warn({ err: erreur }, 'état de la machine non mesuré : rien envoyé');
    }
  }

  /** Un état reçu d'un pair : gardé, et sa MAC rangée sous l'identifiant de sa machine (réveil). */
  recevoir(membre: string, etat: EtatNoeud): void {
    this.recus.set(membre, etat);
    const machine = this.d.machineDe(membre);
    if (!this.d.reseaux || !etat.reseau || !machine) return;
    this.d.reseaux.retenir(machine, etat.reseau);
  }

  /** Le dernier état reçu du pair, ou null s'il n'en a jamais envoyé. */
  de(membre: string): EtatNoeud | null {
    return this.recus.get(membre) ?? null;
  }

  oublier(membre: string): void {
    this.recus.delete(membre);
  }
}
