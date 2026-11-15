// Responsabilité : le contrat de la source de données du monde — ce que le magasin lit et ce que les actions envoient.
// Implémenté par le transport (relais réel) et par la démo : le reste de l'app ne sait pas laquelle tourne.
import type { ActionSession, EtatRelais, EvenementDate, MessageClient, ReponseDialogue } from './contrat';
import type { ServiceFichiers } from './fichiers';
import type { FabriqueTerminal } from './terminal';

export type EtatLien = 'connexion' | 'ouvert' | 'coupe';
export type NomSource = 'demo' | 'relais';

export interface EcouteurSource {
  surMessage(message: MessageClient): void;
  surLien(lien: EtatLien): void;
}

export interface ApiMonde {
  envoyerMessage(sessionId: string, texte: string): Promise<void>;
  repondre(sessionId: string, reponse: ReponseDialogue): Promise<void>;
  agir(sessionId: string, action: ActionSession): Promise<void>;
}

export interface SourceMonde {
  readonly nom: NomSource;
  readonly api: ApiMonde;
  /** Fichiers des postes (liste, lecture, écriture, renommage, suppression). */
  readonly fichiers: ServiceFichiers;
  /** Ouvre un terminal à distance sur un poste (shell ou session tmux). */
  readonly ouvrirTerminal: FabriqueTerminal;
  etatInitial(): Promise<EtatRelais>;
  evenements(sessionId: string): Promise<EvenementDate[]>;
  demarrer(ecouteur: EcouteurSource): void;
  arreter(): void;
}
