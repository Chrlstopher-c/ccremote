// Responsabilité : le contrat entre le nœud fédéré et ses modules (liens, admissions, appareils, appairage,
// machines) — ce qu'ils lisent ou écrivent du nœud lui-même (pairs, configuration, services partagés), sans le
// nœud.
import type { Identite } from '../../commun/chiffrement/identite.ts';
import type { Canaux } from './canaux.ts';
import type { CacheDistant } from './distant.ts';
import type { OptionsFederation } from './etat-federation.ts';
import type { Voisinage } from './proprietaire.ts';
import type { CharteNoeud } from './charte-noeud.ts';
import type { ConfigAiguilleur, PairFederee, SecretsNoeud } from './secrets.ts';

export interface PortNoeud {
  readonly options: OptionsFederation;
  readonly secrets: SecretsNoeud;
  readonly canaux: Canaux;
  readonly voisins: Voisinage;
  readonly charte: CharteNoeud;
  readonly distant: CacheDistant;
  /** Les nœuds refusés pour la suite de l'appairage (partagé, relu et modifié par les modules). */
  readonly refus: Set<string>;
  pairs(): PairFederee[];
  definirPairs(pairs: PairFederee[]): void;
  config(): ConfigAiguilleur | null;
  definirConfig(config: ConfigAiguilleur): void;
  identifiantProtocole(): string | null;
  proprietaireLocal(): string | null;
  estNoeud(membre: string): boolean;
  identite(): Promise<Identite>;
  signaler(): void;
  sauverPairs(): void;
}
