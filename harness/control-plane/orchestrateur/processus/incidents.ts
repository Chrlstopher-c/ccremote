/**
 * Responsabilité : trace durable des incidents du PROCESSUS orchestrateur
 * lui-même (pas des équipes — ça, c'est le registre E). Un seul type
 * d'incident aujourd'hui : fermeture non sollicitée du flux d'entrée (H-60).
 *
 * `⚠` Volontairement HORS de `logs/` : la convention du dépôt réinitialise
 * `logs/` à chaque redémarrage (`start.sh`, sans append) — exactement l'inverse
 * de ce qu'il faut ici. Un incident doit survivre à un crash du process pour
 * rester visible à la prochaine réconciliation ou revue humaine (A.4.2). NDJSON
 * append-only : un incident de plus n'écrase jamais les précédents, et un
 * fichier tronqué en cours d'écriture (crash pendant le write) ne corrompt que
 * sa dernière ligne, jamais l'historique.
 */

import { processusOrchestrateurLogger as journal } from './logger.ts';

export type TypeIncidentOrchestrateur = 'fermeture_flux_entree_imprevue';

export interface IncidentOrchestrateur {
  readonly type: TypeIncidentOrchestrateur;
  readonly instant: number;
  readonly details: Readonly<Record<string, unknown>>;
}

/** Port — permet un doublage en mémoire dans les tests, sans toucher au disque. */
export interface JournalIncidentsOrchestrateur {
  enregistrer(incident: IncidentOrchestrateur): Promise<void> | void;
}

/** Adaptateur fichier réel — une ligne JSON par incident, jamais tronqué. */
export class JournalIncidentsFichier implements JournalIncidentsOrchestrateur {
  constructor(private readonly chemin: string) {}

  async enregistrer(incident: IncidentOrchestrateur): Promise<void> {
    try {
      const ligne = `${JSON.stringify(incident)}\n`;
      const existant = await Bun.file(this.chemin)
        .text()
        .catch(() => '');
      await Bun.write(this.chemin, existant + ligne);
    } catch (erreur) {
      journal.error({ err: erreur, chemin: this.chemin }, "échec d'écriture de l'incident orchestrateur sur disque");
      throw erreur;
    }
  }
}

/** Doublure en mémoire — pour les tests et pour un appelant qui compose sa propre persistance. */
export class JournalIncidentsMemoire implements JournalIncidentsOrchestrateur {
  readonly incidents: IncidentOrchestrateur[] = [];

  enregistrer(incident: IncidentOrchestrateur): void {
    this.incidents.push(incident);
  }
}
