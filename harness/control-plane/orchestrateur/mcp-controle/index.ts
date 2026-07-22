/**
 * Interface publique du module « mcp-controle » (branche A.2, mission M-40).
 * Aucun autre module ne doit importer les fichiers internes de ce dossier.
 *
 * Périmètre : le serveur MCP de contrôle de l'orchestrateur — les outils par
 * lesquels la session Agent SDK du Pi (A.1) agit sur le parc. Ce module ne
 * réimplémente aucune des branches déléguées (E, F, C, G) : il les invoque via
 * des ports (`types.ts`), à l'exception des lectures E/F déjà publiques
 * (`registre`, `projets`) qui sont appelées directement — même esprit que
 * `control-plane/reconciliation/`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Deux contradictions résolues entre `04-arbre-A-orchestrateur.md` (mon fichier
 * de branche) et `16-decisions-operateur.md` (FAIT AUTORITÉ, postérieur) :
 *
 * 1. **`arret_urgence`** — A.2.2 le liste comme outil de l'orchestrateur.
 *    H-57 l'interdit explicitement : « ne passent ni l'une ni l'autre
 *    [pause globale, arrêt d'urgence] par l'orchestrateur ». Résolu en faveur
 *    de H-57 (postérieur, FAIT AUTORITÉ) : **absent** de la surface d'outils
 *    (`serveur.ts`, testé en négatif dans `serveur.test.ts`). Le chemin réel est
 *    direct — téléphone → control plane → transport → superviseur — hors
 *    périmètre de la mission A.2.
 *
 * 2. **`creer_equipe`** — A.2.2 le décrit comme « nouvelle équipe sur un
 *    projet, avec un mandat », déléguant « F puis B ». H-61 (postérieur, FAIT
 *    AUTORITÉ) précise : l'outil ne crée RIEN, il retourne `effet: 'differe'`
 *    avec une proposition de mandat que l'UI présente à l'approbation humaine
 *    explicite. Implémenté selon H-61 (`proposerCreationEquipe`,
 *    `mandat.ts`) — non implémenté : le dispatch réel après clic humain, qui
 *    n'existe délibérément pas encore (H-61 : « structure à prévoir, pas à
 *    implémenter »).
 * ─────────────────────────────────────────────────────────────────────────
 */

export { creerServeurMcpControle, construireOutilsControle, protege, UTILISATION_PARC_DESACTIVEE } from './serveur.ts';
export type { DependancesServeurControle } from './serveur.ts';

export { applique, accepte, refuse, differe, echecInattendu } from './contrat.ts';
export { avecPlafond, PLAFOND_PORT_MS_DEFAUT } from './plafond.ts';
export type { ResultatPlafonne } from './plafond.ts';
export { construireMandatPropose } from './mandat.ts';
export type { PropositionMandat } from './mandat.ts';

export {
  listerEquipes,
  etatEquipe,
  listerProjets,
  historiqueEquipe,
  permissionsEnAttente,
} from './outils-inspection.ts';
export {
  proposerCreationEquipe,
  envoyerAEquipe,
  interrompreEquipe,
  arreterEquipe,
  relancerEquipe,
} from './outils-cycle-vie.ts';
export { repondrePermission, definirBudget } from './outils-arbitrage.ts';

export type {
  ArbitreEscalade,
  ArreteurMission,
  CibleEquipe,
  ContratRetour,
  DefinisseurBudget,
  EffetOutil,
  LecteurEscalades,
  RelanceurMission,
  RepertoireCibles,
} from './types.ts';

export { mcpControleLogger } from './logger.ts';
