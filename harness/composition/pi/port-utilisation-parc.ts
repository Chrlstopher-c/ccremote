/**
 * Responsabilité : implémentation RÉELLE du port `LecteurUtilisationParc`
 * (G.1.3, `control-plane/orchestrateur/mcp-controle/types.ts`), attendu par
 * `proposerCreationEquipe` (`creer_equipe`) — H-74, occurrence n°2 : ce port
 * est optionnel dans `DependancesServeurControle` et retombe sur
 * `UTILISATION_PARC_DESACTIVEE` en son absence. Ce fichier est le premier
 * site de production qui le fournit réellement plutôt que de laisser le
 * plafond de parc silencieusement désactivé.
 *
 * Source : `Registre.comptes` (E.1, déjà alimenté par les relevés
 * `rate_limit_event` — voir `superviseur/budgets-workers.ts` côté PC, hors
 * périmètre de ce fichier). Lecture SYNCHRONE pure, comme l'exige le contrat
 * du port : aucun appel réseau ici, seulement la base déjà ouverte.
 */

import type { Registre } from '../../control-plane/registre/index.ts';
import type { LecteurUtilisationParc } from '../../control-plane/orchestrateur/mcp-controle/types.ts';
import type { RelevePourPlafond } from '../../budgets/index.ts';

export function creerLecteurUtilisationParc(registre: Registre): LecteurUtilisationParc {
  return {
    comptesConnus(): readonly string[] {
      return registre.comptes.lister().map((compte) => compte.id);
    },
    releves(compteId: string): readonly RelevePourPlafond[] {
      return registre.comptes.listerQuotas(compteId).map(
        (quota): RelevePourPlafond => ({
          compteId: quota.compteId,
          typeFenetre: quota.typeFenetre,
          utilisation: quota.utilisation,
          statut: quota.statut,
        }),
      );
    },
  };
}
