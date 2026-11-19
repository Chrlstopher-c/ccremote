// Responsabilité : exécuter sur le poste les commandes du relais qui touchent aux artefacts d'une session. Une erreur
// est journalisée et rendue au relais comme un refus, jamais propagée.
import type { Logger } from 'pino';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import {
  dupliquerArtefact,
  epinglerArtefact,
  listerArtefacts,
  renommerArtefact,
  supprimerArtefact,
} from './artefacts.ts';
import type { Stockage } from './stockage.ts';

export type CommandeArtefact = Extract<
  CommandeRelais,
  { kind: 'artefacts' | 'artefact_renommer' | 'artefact_dupliquer' | 'artefact_supprimer' | 'artefact_epingler' }
>;

export const estCommandeArtefact = (c: CommandeRelais): c is CommandeArtefact => c.kind.startsWith('artefact');

export interface ReponseArtefact {
  readonly ok: boolean;
  readonly erreur?: string;
  readonly donnees?: unknown;
}

function executer(stockage: Stockage, c: CommandeArtefact): unknown {
  switch (c.kind) {
    case 'artefacts':
      return listerArtefacts(stockage, c.sessionId);
    case 'artefact_renommer':
      return renommerArtefact(stockage, c.sessionId, c.artefact, c.titre);
    case 'artefact_dupliquer':
      return dupliquerArtefact(stockage, c.sessionId, c.artefact);
    case 'artefact_supprimer':
      supprimerArtefact(stockage, c.sessionId, c.artefact);
      return { ok: true };
    case 'artefact_epingler':
      return epinglerArtefact(stockage, c.sessionId, c.artefact, c.epingle);
  }
}

export function executerArtefacts(stockage: Stockage, c: CommandeArtefact, journal: Logger): ReponseArtefact {
  try {
    return { ok: true, donnees: executer(stockage, c) };
  } catch (erreur) {
    journal.warn({ err: erreur, session: c.sessionId, commande: c.kind }, 'geste sur un artefact refusé');
    return { ok: false, erreur: erreur instanceof Error ? erreur.message : String(erreur) };
  }
}
