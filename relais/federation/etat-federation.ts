// Responsabilité : la forme de l'état de la fédération (`GET /api/federation`) et les options de sa construction.
// Données seules : c'est `federation.ts` qui les remplit et les lit.
import type { AppairageEnCours } from './appairages.ts';
import type { DemandeAppairage } from './demandes.ts';
import type { MotifArret } from './lien-aiguilleur.ts';
import type { MembreVu } from './proprietaire.ts';
import type { NoeudAppaire } from './appairages.ts';
import type { Logger } from 'pino';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Registre } from '../registre/registre.ts';
import type { PontFederation } from './echanges.ts';
import type { ServirAppareil } from './appareils.ts';

export interface EtatFederation {
  readonly aiguilleur: {
    readonly url: string;
    readonly id: string;
    readonly nom: string;
    readonly proprietaire: string | null;
    readonly relie: boolean;
    readonly motif: MotifArret | null;
  } | null;
  readonly empreinteLocale: string;
  /** Les membres de la présence de l'aiguilleur ; `mien` : un nœud de notre propriétaire. */
  readonly membres: readonly MembreVu[];
  readonly noeuds: readonly NoeudAppaire[];
  readonly demandes: readonly DemandeAppairage[];
  readonly appairages: readonly AppairageEnCours[];
}

export interface OptionsFederation {
  readonly registre: Registre;
  readonly diffusion: Diffusion;
  readonly dossierSecrets: string;
  readonly machine: string;
  readonly pont: PontFederation;
  readonly journal: Logger;
  readonly delaiDemandeMs?: number;
  readonly intervallePlanificationMs?: number;
  /** Notification à Chris (une demande attend sa décision sur ce nœud). */
  readonly notifier?: (titre: string, texte: string) => void;
  /** Observe chaque charge échangée avec l'aiguilleur (essais : prouver qu'il ne voit que du chiffré). */
  readonly observer?: (sens: 'envoi' | 'reception', charge: string) => void;
  /** Sert l'API clients à un appareil appairé, dans son canal (absent : 503). */
  readonly servirAppareil?: ServirAppareil;
  /** Nœud embarqué (non autonome) : il peut fonder le réseau du parc à la première liaison (migration). */
  readonly peutReprendre?: boolean;
}
