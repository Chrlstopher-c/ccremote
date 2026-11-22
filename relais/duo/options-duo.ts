// Responsabilité : les options de construction du mode duo d'un relais — ce qu'il reçoit du relais (registre,
// diffusion, base, identité, écoute, sessions, postes). Aucun comportement ici.
import type { Database } from 'bun:sqlite';
import type { Logger } from 'pino';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import type { PontSessions } from './pont-sessions.ts';

export interface OptionsDuo {
  readonly registre: Registre;
  readonly diffusion: Diffusion;
  readonly base: Database;
  readonly utilisateur: string;
  readonly dossierSecrets: string;
  readonly ecoute: string | null;
  readonly port: number;
  /** Faux pour un ami ajouté : pas de port d'écoute, le lien passe par l'aiguilleur seulement (défaut : vrai). */
  readonly ecouteDirecte?: boolean;
  readonly journal: Logger;
  readonly maintenant?: () => number;
  readonly delaiReconnexionMs?: number;
  readonly delaiDemandeMs?: number;
  readonly sessions: PontSessions;
  readonly postes: Pick<Postes, 'commander'>;
}
