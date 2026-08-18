/**
 * Responsabilité : serveur MCP en-process donnant à un LEAD la connaissance de
 * SA PROPRE dépense — ce que sa mission a coûté jusqu'ici, son plafond, la part
 * consommée, et son contexte si disponible.
 *
 * `☠` Né d'un incident réel (mandat opérateur, 18/08) : une équipe de diagnostic
 * a bâti son hypothèse principale sur un supposé dépassement de budget alors
 * qu'elle était à 15 % de son plafond. Elle ne pouvait pas savoir — rien ne le
 * lui disait.
 *
 * `☠` LECTURE PURE, AUCUN EFFET DE BORD. La donnée de coût existe à deux
 * endroits : le collecteur de télémétrie du PC (`CollecteurTelemetrie`,
 * alimenté EN DIRECT par le flux SDK du worker) et le registre des missions du
 * Pi (alimenté avec un retard de balayage — 5 s — et un aller-retour réseau).
 * On retient le PC : c'est la MÊME machine qui héberge ce serveur MCP en-process
 * — aucune dépendance réseau, et sa valeur est structurellement la plus fraîche
 * puisque le Pi ne fait que recopier ce que le PC lui a déjà transmis.
 *
 * `☠` NON-RÉGRESSION (défaut corrigé le 18/08 dans `#enfilerApprentissageSiConfigure`,
 * commit `1adff2f`) : la lecture passe par `CollecteurTelemetrie.lireParSessionId()`,
 * qui délègue à la même vue NON DRAINANTE que `.lire()` — jamais `.tous()`, qui
 * VIDE la file d'activités en attente de TOUTES les missions du process à chaque
 * appel. Un outil de consultation qui l'utiliserait détruirait, pour l'équipe qui
 * consulte sa propre dépense ET pour toutes les autres, le fil tout juste ingéré
 * avant que le balayage du Pi (5 s) ne l'ait écrit en base.
 */

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Nom du serveur — exporté pour que les tests qui listent « tout ce qui est cité au lead » le connaissent. */
export const NOM_SERVEUR_MCP_DEPENSE = 'ccremote-depense';

/** Ce que le port de lecture rend — un sous-ensemble de `TelemetrieWorker`, jamais le type entier (frontière de domaine). */
export interface DepenseMission {
  readonly coutUsd: number;
  readonly contexteTokensUtilises: number | null;
  readonly contexteTokensMax: number | null;
}

/**
 * Port de lecture — `sessionId` en entrée, car c'est tout ce qu'un worker
 * connaît de lui-même (`missionId` est une identité du registre du Pi, jamais
 * transmise au worker). `null` : mission pas encore ouverte en télémétrie
 * (fenêtre très courte, juste après le spawn) — pas une panne.
 */
export type LecteurDepenseMission = (sessionId: string) => DepenseMission | null;

export interface DependancesServeurDepense {
  readonly sessionId: string;
  /** Le plafond RÉEL transmis au SDK en `maxBudgetUsd` — celui qui coupe. */
  readonly plafondUsd: number;
  /** `true` si ce plafond a été fixé explicitement pour CETTE mission, `false` s'il retombe sur le plafond de parc. */
  readonly plafondPropre: boolean;
  readonly lecteurDepense: LecteurDepenseMission;
}

function rendre(corps: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(corps) }] };
}

/**
 * Assemble la définition de l'outil. Exporté séparément de
 * `creerServeurMcpDepense` pour rester testable sans passer par le protocole
 * MCP complet — même patron que `construireOutilsControle` (`mcp-controle/serveur.ts`).
 */
export function construireOutilsDepense(deps: DependancesServeurDepense) {
  return [
    tool(
      'ma_depense',
      "Ce que TA mission a dépensé jusqu'ici, en dollars, ton plafond et la part déjà " +
        "consommée. À consulter AVANT d'engager un travail long, ou dès que tu hésites à " +
        "approfondir une piste — tu ne peux pas deviner ta consommation autrement, et bâtir " +
        "une hypothèse sur un dépassement de budget supposé sans l'avoir vérifié ici a déjà " +
        "coûté cher à une équipe. Lecture seule, aucun effet de bord : n'hésite pas à l'appeler " +
        "aussi souvent que tu veux.",
      {},
      async () => {
        try {
          const t = deps.lecteurDepense(deps.sessionId);
          const coutUsd = t?.coutUsd ?? 0;
          const pourcentageConsomme = deps.plafondUsd > 0 ? Math.round((coutUsd / deps.plafondUsd) * 1000) / 10 : 0;
          return rendre({
            coutUsd,
            plafondUsd: deps.plafondUsd,
            plafondPropre: deps.plafondPropre,
            note: deps.plafondPropre
              ? 'plafond propre à cette mission.'
              : 'aucun plafond propre fixé pour cette mission — tu cours sous le plafond de parc.',
            pourcentageConsomme,
            contexteTokensUtilises: t?.contexteTokensUtilises ?? null,
            contexteTokensMax: t?.contexteTokensMax ?? null,
          });
        } catch (erreur) {
          // `☠` Ne relance JAMAIS vers le modèle — un chiffre d'affichage ne
          // vaut pas la peine de faire échouer l'appel d'outil.
          return rendre({ erreur: 'lecture de la dépense en échec', detail: String(erreur) });
        }
      },
      { annotations: { readOnlyHint: true } },
    ),
  ];
}

/** Assemble le serveur MCP de consultation, un par worker (le plafond et le sessionId sont figés à la construction). */
export function creerServeurMcpDepense(deps: DependancesServeurDepense): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: NOM_SERVEUR_MCP_DEPENSE,
    version: '0.1.0',
    tools: construireOutilsDepense(deps),
  });
}
