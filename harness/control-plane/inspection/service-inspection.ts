/**
 * Responsabilité : orchestrer une inspection à la demande de bout en bout —
 * interroger le juge sur le PC, persister son verdict, puis arbitrer.
 *
 * `☠` La persistance n'est pas un détail d'affichage. Le verdict était rendu
 * côté PC et perdu dans la seconde : `vue-missions.ts` écrivait
 * `{ lastVerdict: null }` en dur, et un rafraîchissement de page effaçait l'avis
 * qu'on venait de demander. Un avis qu'on ne peut pas relire n'aide personne à
 * décider.
 *
 * `☠` L'inspection ne coupe JAMAIS d'elle-même : elle rend un verdict et, si
 * c'est `boucle`, ouvre une décision que l'opérateur tranche. Confirmer arrête
 * l'équipe ; décliner la laisse tourner — et l'écrit, ce qui distingue « j'ai vu
 * et j'assume » de « je n'ai pas regardé ».
 */

import type { Registre } from '../registre/index.ts';
import {
  verdictArbitrable,
  type DecisionInspection,
  type EtatInspection,
  type VerdictInspection,
} from './etat-inspection.ts';

const VERDICTS: readonly string[] = ['progres', 'incertain', 'boucle'];

/** Le juge, vu d'ici — le lien vers le PC le satisfait. */
export interface PortJugeDistant {
  inspecter(missionId: string): Promise<{ readonly verdict: string; readonly motif: string }>;
}

export interface PortArretEquipe {
  arreter(missionId: string): Promise<void>;
}

export class ErreurInspection extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurInspection';
  }
}

/**
 * `☠` Le verdict vient d'un modèle : c'est une entrée non fiable, validée avant
 * d'atteindre la base. Un verdict inconnu écrit tel quel rendrait l'état de la
 * mission illisible pour toute la suite — et pire, `attendArbitrage` ne le
 * reconnaîtrait pas comme une boucle, donc personne ne serait prévenu.
 */
function verdictValide(brut: string): VerdictInspection {
  if (!VERDICTS.includes(brut)) {
    throw new ErreurInspection(`verdict « ${brut} » inconnu — attendus : ${VERDICTS.join(', ')}`);
  }
  return brut as VerdictInspection;
}

export class ServiceInspection {
  constructor(
    private readonly registre: Registre,
    private readonly juge: PortJugeDistant,
    private readonly arreteur: PortArretEquipe,
  ) {}

  /** Lance une inspection et persiste son verdict. Ne coupe jamais. */
  async inspecter(missionId: string): Promise<EtatInspection> {
    const mission = this.registre.missions.lire(missionId);
    if (mission === null) throw new ErreurInspection('équipe introuvable');
    // `☠` Le juge vit sur le PC : lien coupé, délai dépassé, opération refusée —
    // autant de conditions MÉTIER, pas de pannes du control plane. Sans ce
    // rattrapage elles remontaient en 500 « erreur interne » (mesuré le 01/08),
    // et l'opérateur ne savait ni ce qui s'était passé ni s'il pouvait réessayer.
    let rendu: { readonly verdict: string; readonly motif: string };
    try {
      rendu = await this.juge.inspecter(missionId);
    } catch (erreur) {
      throw new ErreurInspection(
        `le juge n’a pas pu être interrogé : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
      );
    }
    const verdict = verdictValide(rendu.verdict);
    // `☠` Écrit AVANT de rendre la main : si l'appelant tombe entre les deux, le
    // verdict est déjà lisible dans le Parc. L'inverse le perdrait en silence,
    // et c'est précisément le défaut qu'on corrige.
    return this.registre.missions.poserInspection(missionId, verdict, rendu.motif).inspection;
  }

  /**
   * Tranche une inspection en attente. `confirme` arrête l'équipe, `decline` la
   * laisse tourner — et l'écrit dans les deux cas.
   */
  async trancher(missionId: string, decision: DecisionInspection): Promise<EtatInspection> {
    const mission = this.registre.missions.lire(missionId);
    if (mission === null) throw new ErreurInspection('équipe introuvable');
    const verdict = verdictArbitrable(mission.inspection);
    if (!verdict.ok) throw new ErreurInspection(verdict.raison ?? 'rien à arbitrer sur cette équipe');
    if (decision === 'en_attente') throw new ErreurInspection('« en_attente » n’est pas une décision — attendus : confirme, decline');

    // `☠` L'arrêt AVANT l'écriture, et la décision seulement s'il a réussi : une
    // mission marquée `confirme` alors que l'arrêt a échoué afficherait une
    // équipe arrêtée qui travaille encore. Dans l'autre sens, un arrêt réussi
    // non écrit se corrige au prochain relevé — l'échange n'est pas symétrique.
    if (decision === 'confirme') await this.arreteur.arreter(missionId);
    return this.registre.missions.trancherInspection(missionId, decision).inspection;
  }
}
