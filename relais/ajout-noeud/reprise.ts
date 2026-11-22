// Responsabilité : la reprise d'attribution quand une machine passe de son poste (vu par un tunnel) à son nœud — ses
// sessions gardent leur identifiant, donc leur machine, leur badge, leur titre (tenu par le poste) et leurs catégories
// (tenues ici, par identifiant). Restent les drapeaux tenus par ce relais : l'épinglage est reporté sur le nœud par le
// geste fédéré `epingler` ; les sessions archivées restent ici (la vue fédérée les garde, le nœud ne les annonce pas).
import type { RepriseAjout } from '../../commun/ajout-noeud.ts';
import type { ResumeSession } from '../../commun/session.ts';

export interface PlanReprise {
  readonly bilan: RepriseAjout;
  /** Sessions à épingler sur le nœud. */
  readonly aEpingler: readonly string[];
}

/** Pur : compare les fiches gardées ici pour `machine` à celles que son nœud annonce. */
export function planReprise(
  locales: readonly ResumeSession[],
  distantes: readonly ResumeSession[],
  machine: string,
): PlanReprise {
  const siennes = locales.filter((s) => s.machine === machine && !s.duo);
  const parId = new Map(distantes.map((s) => [s.id, s]));
  const actives = siennes.filter((s) => s.archivee !== true);
  const retrouvees = actives.filter((s) => parId.has(s.id));
  const aEpingler = retrouvees
    .filter((s) => s.epinglee === true && parId.get(s.id)?.epinglee !== true)
    .map((s) => s.id);
  return {
    bilan: {
      retrouvees: retrouvees.length,
      absentes: actives.length - retrouvees.length,
      epinglees: aEpingler.length,
      archivees: siennes.length - actives.length,
    },
    aEpingler,
  };
}

/** Le geste d'épinglage d'une session distante, par le chemin d'une requête de l'appli (relayée au nœud). */
export type Epingler = (session: string) => Promise<boolean>;

/** Applique le plan : rend le bilan, avec le nombre d'épinglages effectivement reportés. */
export async function appliquerReprise(plan: PlanReprise, epingler: Epingler): Promise<RepriseAjout> {
  let faits = 0;
  for (const id of plan.aEpingler) if (await epingler(id)) faits += 1;
  return { ...plan.bilan, epinglees: faits };
}
