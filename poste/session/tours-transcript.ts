// Responsabilité : les tours d'une session lue dans son transcript (hors Lanterne), au même format que le
// `tour_fini` du SDK. Un tour se termine à sa ligne `system/turn_duration` du fil principal ; ses jetons sont
// ceux des messages assistant du tour, comptés une fois par identifiant de message (Claude Code écrit une ligne
// par bloc, toutes avec le même `usage`). Une fin de tour sans réponse de Claude ne compte pas. L'état court d'une
// ligne à la suivante, dans l'ordre du transcript : la relecture complète et le suivi incrémental donnent les mêmes
// événements. Pur.
import type { Evenement } from '../../commun/session.ts';
import { contexteDe, estErreurApi, type Ligne } from './traduction.ts';

type TourFini = Extract<Evenement, { type: 'tour_fini' }>;

export class CompteTours {
  private messagesVus = new Set<string>();
  private reponses = 0;
  private entree = 0;
  private sortie = 0;
  private derniereEntree: string | null = null;
  private contexte = 0; // dernier contexte lu, gardé d'un tour à l'autre

  /** Événements de fin de tour produits par cette ligne (au plus un). */
  ligne(l: Ligne): Evenement[] {
    if (l.isSidechain === true) return [];
    if (l.type === 'assistant') this.reponse(l);
    if (l.type === 'system' && l.subtype === 'turn_duration') return this.cloture(l);
    return [];
  }

  private reponse(l: Ligne): void {
    if (estErreurApi(l)) return;
    this.reponses += 1;
    const cle = typeof l.message?.id === 'string' ? l.message.id : null;
    if (cle === null || !this.messagesVus.has(cle)) {
      if (cle !== null) this.messagesVus.add(cle);
      this.compter(l);
    }
    if (typeof l.uuid === 'string') this.derniereEntree = l.uuid;
    this.contexte = contexteDe(l) ?? this.contexte;
  }

  private compter(l: Ligne): void {
    const usage = l.message?.usage ?? {};
    const lus = nombre(usage['cache_read_input_tokens']) + nombre(usage['cache_creation_input_tokens']);
    this.entree += nombre(usage['input_tokens']) + lus;
    this.sortie += nombre(usage['output_tokens']);
  }

  private cloture(l: Ligne): Evenement[] {
    const fin: TourFini = {
      type: 'tour_fini',
      dureeMs: nombre(l.durationMs),
      contexte: this.contexte,
      entree: this.entree,
      sortie: this.sortie,
      ...(this.derniereEntree === null ? {} : { uuid: this.derniereEntree }),
    };
    const sansReponse = this.reponses === 0;
    this.messagesVus.clear();
    this.reponses = 0;
    this.entree = 0;
    this.sortie = 0;
    this.derniereEntree = null;
    return sansReponse ? [] : [fin];
  }
}

function nombre(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
