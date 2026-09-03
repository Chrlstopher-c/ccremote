/**
 * Responsabilité : rendre le hook `PostCompact` ACTIF (axe B, lot B-b, B3) —
 * capturer le résumé NATIF produit par la compaction du CLI et le structurer
 * pour `team.resume_contexte` (D2). Complète `observateur-compaction.ts`, qui
 * reste purement observationnel (classement sain/pathologique) : ce module ne
 * classe rien, il PRODUIT la matière que `composerPromptReveil` réinjecte au
 * réveil d'une team (`control-plane/orchestrateur/dispatch-mandat.ts`).
 *
 * `☠` AUCUN APPEL LLM ICI, PAR CONSTRUCTION. La source établie est
 * `PostCompactHookInput.compact_summary` — sdk.d.ts (@anthropic-ai/claude-agent-sdk) :
 * « The conversation summary produced by compaction ». C'est le résumé que le
 * CLI produit DÉJÀ pour sa propre compaction (`settings.autoCompactEnabled`,
 * posé inconditionnellement par `workers/options-composition.ts`) — ce module
 * ne fait que LIRE un champ déjà livré par le hook, jamais construire un
 * second appel modèle. Aucune fonction de ce fichier n'importe `query` du SDK
 * ni n'invoque quoi que ce soit qui parle au réseau — vérifiable par lecture :
 * les seules I/O sont les callbacks `onResume`/`log` injectés par l'appelant.
 *
 * `☠` Frontière A↔B : ce hook se déclenche côté WORKER (PC), `team` vit sur le
 * Pi (`control-plane/registre/teams.ts`). Ce module ne connaît ni l'un ni
 * l'autre — il rend un BLOC DE TEXTE formaté à un `onResume` injecté par
 * l'appelant. Côté PC (`workers/`), `onResume` alimente le collecteur de
 * télémétrie (canal transportable PC→Pi existant, `superviseur/collecteur-telemetrie.ts`) ;
 * côté Pi (`composition/pi/balayage-telemetrie.ts`), le bloc drainé est fusionné
 * à l'existant et écrit via `DepotTeams.majResume` — jamais un import direct
 * control-plane ↔ superviseur.
 */

import type { HookCallback, SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk'

/** Format opposable : le résumé devient une ENTRÉE du tour suivant (D2, risque documenté au plan). */
const MARQUEUR_BLOC = '§RESUME-COMPACTION§'
const SEPARATEUR_BLOC = '\n\n'
/** Garde N derniers résumés — append borné, jamais un log infini (mandat). */
const MAX_BLOCS_PAR_DEFAUT = 5

const OBSERVATION_VIDE: SyncHookJSONOutput = {}

/**
 * Structure un résumé natif brut en un bloc traçable et daté. `null` si le
 * résumé est vide/blanc — jamais de bloc vide écrit (même règle que
 * `composerPromptReveil` : vide ⇒ rien à réinjecter).
 */
export function formaterBlocResume(compactSummary: string, trigger: 'manual' | 'auto', instant: number): string | null {
  const propre = compactSummary.trim()
  if (propre.length === 0) return null
  const horodatage = new Date(instant).toISOString()
  return `${MARQUEUR_BLOC} [${horodatage}, déclencheur=${trigger}]\n${propre}`
}

/**
 * Append BORNÉ : garde les `maxBlocs` derniers résumés, jamais un log infini.
 * `existant` peut porter d'anciens blocs (séparés par `SEPARATEUR_BLOC`) ou être
 * `null`/vide (première compaction de la team). Idempotent sur la forme : un
 * texte sans marqueur reconnu est traité comme UN bloc unique (compat avec un
 * `resume_contexte` déjà écrit par une autre voie).
 */
export function fusionnerResumeBorne(
  existant: string | null,
  nouveauBloc: string,
  maxBlocs: number = MAX_BLOCS_PAR_DEFAUT,
): string {
  const precedents = decouperBlocs(existant)
  const tous = [...precedents, nouveauBloc]
  const bornes = tous.slice(Math.max(0, tous.length - maxBlocs))
  return bornes.join(SEPARATEUR_BLOC)
}

function decouperBlocs(texte: string | null): readonly string[] {
  const propre = texte?.trim() ?? ''
  if (propre.length === 0) return []
  return propre
    .split(SEPARATEUR_BLOC)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
}

/** Port minimal requis pour capturer un résumé — jamais la forme SDK complète du hook. */
export interface EntreePostCompact {
  readonly trigger: 'manual' | 'auto'
  readonly compact_summary: string
}

export interface OptionsHookResumeCompaction {
  /** Reçoit le bloc déjà formaté (non fusionné : la fusion vit côté Pi, seul dépositaire de l'existant). */
  readonly onResume: (bloc: string) => void
  readonly horloge?: { maintenant(): number }
  readonly surErreur?: (erreur: unknown) => void
}

/**
 * Traite une entrée `PostCompact` déjà narrowée. Fonction pure hors l'appel à
 * `onResume` — testable sans hook SDK ni horloge réelle.
 */
export function traiterPostCompact(entree: EntreePostCompact, options: OptionsHookResumeCompaction): void {
  const instant = options.horloge?.maintenant() ?? Date.now()
  const bloc = formaterBlocResume(entree.compact_summary, entree.trigger, instant)
  if (bloc === null) return
  options.onResume(bloc)
}

/**
 * Construit le callback `Options.hooks.PostCompact` — hook ACTIF (avant ce
 * module, `contexte-integration.ts` ne faisait qu'observer l'événement, jamais
 * son contenu). Ne bloque jamais, ne lève jamais (même discipline que
 * `workers/audit-hooks.ts`) : une panne de capture de résumé ne doit jamais
 * casser un tour de la team.
 */
export function creerHookPostCompactResume(options: OptionsHookResumeCompaction): HookCallback {
  return async (input): Promise<SyncHookJSONOutput> => {
    if (input.hook_event_name !== 'PostCompact') return OBSERVATION_VIDE
    try {
      traiterPostCompact({ trigger: input.trigger, compact_summary: input.compact_summary }, options)
    } catch (erreur) {
      options.surErreur?.(erreur)
    }
    return OBSERVATION_VIDE
  }
}
