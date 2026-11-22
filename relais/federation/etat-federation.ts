// Responsabilité : la forme de l'état de la fédération (`GET /api/federation`) et les options de sa construction.
// Données seules : c'est `federation.ts` qui les remplit et les lit.
import type { ReseauPoste } from '../../commun/entretien.ts';
import type { EtatNoeud } from '../../commun/federation.ts';
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
import type { ReseauxConnus } from '../entretien/reseaux.ts';
import type { Reveil } from '../entretien/reveil.ts';

/** Identifiant de soi tant que ce nœud n'est pas relié à un aiguilleur (il n'a alors pas de membre). */
export const MEMBRE_MOI = 'moi';

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

/** Une machine du réseau (`GET /api/reseau/machines`) : soi, ou un nœud apparié, avec son dernier état connu. */
export interface MachineReseau {
  readonly membre: string;
  readonly nom: string;
  readonly moi: boolean;
  readonly enLigne: boolean;
  readonly etat: EtatNoeud | null;
}

export type EtatFonctionNoeud = EtatNoeud['fonctions']['voix'];

/** Sondes des services de la machine (voix, dictée) ; absentes, la fonction est « absente ». */
export interface FonctionsNoeud {
  readonly voix?: () => EtatFonctionNoeud | Promise<EtatFonctionNoeud>;
  readonly dictee?: () => EtatFonctionNoeud | Promise<EtatFonctionNoeud>;
}

/** Commandes lancées par le nœud (argv) ; absentes, les commandes réelles. Factices en test. */
export interface CommandesNoeud {
  readonly nvidiaSmi?: readonly string[];
  readonly extinction?: readonly string[];
  readonly redemarrage?: readonly string[];
}

export interface OptionsFederation {
  /** Dossier des espaces des invités (sinon LANTERNE_INVITES_DOSSIER, sinon ~/lanterne-invites). */
  readonly invitesRacine?: string;
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
  /** Rejoue les routes locales pour le téléphone chef (`/api/reseau/telephone/…`) : absent, 503. */
  readonly servirChef?: ServirAppareil;
  /** Nœud embarqué (non autonome) : il peut fonder le réseau du parc à la première liaison (migration). */
  readonly peutReprendre?: boolean;
  /** Chef dans la charte du réseau : seul un chef peut agir sur cette machine. Absent : personne ne l'est. */
  readonly estChef?: (membre: string) => boolean;
  /** Compte choisi pour cette machine (charte) : compte par défaut des sessions ouvertes sans compte. */
  readonly compteChoisi?: () => string | null;
  readonly commandes?: CommandesNoeud;
  readonly fonctions?: FonctionsNoeud;
  /** Réseau local (MAC, diffusion) ; absent, relevé sur la machine. */
  readonly reseauLocal?: () => ReseauPoste | null;
  /** Dernier réseau connu de chaque machine : où l'état d'un pair range sa MAC, pour le réveil. */
  readonly reseaux?: ReseauxConnus;
  readonly reveil?: Reveil;
  /** Postes en ligne pouvant relayer un réveil (vide : le nœud envoie lui-même le paquet). */
  readonly postesEnLigne?: () => string[];
}
