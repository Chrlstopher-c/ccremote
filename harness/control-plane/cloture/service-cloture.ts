/**
 * Responsabilité : appliquer la clôture des missions au repos — état terminal,
 * trace dans le fil, libération du worker.
 */

import type { Registre } from '../registre/index.ts';
import type { ArreteurMission } from '../orchestrateur/mcp-controle/types.ts';
import { DELAI_CLOTURE_IDLE_MS, missionsAClore, MOTIF_CLOTURE_IDLE } from './politique-cloture.ts';
import { detecterRaisonCoupure, RAISON_CLOTURE_SANS_RAPPORT } from './raison-terminale.ts';
import { clotureLogger } from './logger.ts';

const log = clotureLogger.child({ composant: 'service' });

export class ServiceCloture {
  constructor(
    private readonly registre: Registre,
    private readonly arreteur: ArreteurMission,
    private readonly delaiMs: number = DELAI_CLOTURE_IDLE_MS,
  ) {}

  /**
   * Clôt ce qui doit l'être. Ne lève jamais : une mission récalcitrante ne doit
   * pas empêcher les autres d'être libérées.
   */
  public async passer(maintenant: number = Date.now()): Promise<number> {
    const aClore = missionsAClore(this.registre.missions.listerActives(), maintenant, this.delaiMs);
    if (aClore.length === 0) return 0;

    let closes = 0;
    for (const mission of aClore) {
      const minutes = Math.round((maintenant - (mission.etatSdkMajA ?? maintenant)) / 60_000);
      try {
        // `☠` `terminee`, pas `annulee` : le lead a rendu sa réponse et a fini
        // nominalement (F2.0.1). L'écrire `annulee` ferait lire un échec là où il
        // y a un travail abouti — et fausserait tout compte par état.
        //
        // `☠` CHANTIER 2 (21/08) : encore faut-il que ce texte EXISTE. `idle` sans
        // rapport reste possible (tour clos sur un appel d'outil) — le même
        // défaut que la clôture fantôme, sous un déclencheur différent. Vérifié
        // AVANT la trace `[HARNESS]` ci-dessous : elle n'est pas un rapport du
        // lead, la compter le serait à tort.
        // Même garde qu'en réconciliation (`reconciliation.ts`) : un texte reconnu
        // comme message de coupure (quota, budget) ne compte jamais comme rapport.
        const dernierTexte = this.registre.missions.dernierTexte(mission.id)?.texte ?? null;
        const raisonCoupure = detecterRaisonCoupure(dernierTexte);
        const rapportRendu = this.registre.missions.aRapportFinal(mission.id) && raisonCoupure === null;
        this.registre.etats.appliquerEtatHarness(mission.id, rapportRendu ? 'terminee' : 'echec_definitif', {
          motif: MOTIF_CLOTURE_IDLE,
          raisonTerminale: rapportRendu ? 'repos_sans_instruction' : (raisonCoupure ?? RAISON_CLOTURE_SANS_RAPPORT),
          maintenant,
        });
        // `☠` Écrite dans le fil, pas seulement dans le journal des transitions :
        // c'est là que Chris regarde quand il se demande pourquoi son équipe
        // n'est plus là, et la phrase doit lui rendre le geste de reprise.
        this.registre.missions.ajouterActivite(
          mission.id,
          `[HARNESS] Équipe close automatiquement après ${minutes} min au repos sans instruction — ` +
            'le projet est libéré pour une nouvelle équipe. La session est conservée : ' +
            '`relancer_equipe` reprend ce contexte exactement où il s’est arrêté.',
          maintenant,
        );
        // Libération best-effort : l'état harness fait autorité (E.1.1), le worker
        // suit. Un PC éteint ne doit pas empêcher la libération du projet.
        await this.arreteur.arreter(mission.id);
        closes += 1;
        log.info(
          { missionId: mission.id, projet: mission.projet, minutesAuRepos: minutes },
          'mission close au repos — projet libéré (H-56)',
        );
      } catch (erreur) {
        // L'état terminal est déjà écrit si l'échec vient de l'arrêteur : le
        // projet est libéré quand même, c'était l'essentiel.
        log.error({ err: erreur, missionId: mission.id }, 'clôture partielle — les autres missions suivent');
      }
    }
    return closes;
  }
}
