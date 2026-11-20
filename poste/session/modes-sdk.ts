// Responsabilité : l'état du mode rapide et d'Ultracode d'une session SDK (ce que Chris demande, ce que le SDK
// rapporte, ce que le modèle permet) — pur : lecture des messages du SDK, bascules, compatibilité. Sans requête.
import type { ModeRapide, ModeUltracode } from '../../commun/session.ts';
import { EtatRapideSdk } from '../../commun/session.ts';
import type { ModeleSdk } from './modele-affiche.ts';
import { modeleEffectif } from './modele-affiche.ts';

// Modèle tel que le SDK le liste à l'initialisation : `supportsFastMode` dit si le mode rapide lui est ouvert.
export type ModeleModes = ModeleSdk & { readonly supportsFastMode?: boolean };

// Réglages appliqués relus dans la requête (`getSettings().applied`) : seuls les booléens connus sont gardés.
export interface ReglagesAppliques {
  readonly ultracode?: boolean;
  readonly ultracodeRequested?: boolean;
  readonly ultracodeAvailable?: boolean;
}

// Ce que le SDK rapporte du mode rapide (message `system`/`init` ou `result`, initialisation).
export interface EtatRapideLu {
  readonly etat: EtatRapideSdk;
  readonly raison: string | null;
}

type Objet = Record<string, unknown>;
const estObjet = (valeur: unknown): valeur is Objet => typeof valeur === 'object' && valeur !== null;
const RAISON_SANS_DEMANDE = 'sdk_opt_in_required'; // le SDK exige l'accord explicite : sans demande, rien à signaler

export function rapideDefaut(): ModeRapide {
  return { demande: false, etat: null, raison: null, compatible: null };
}

export function ultracodeDefaut(): ModeUltracode {
  return { demande: false, actif: false, disponible: null };
}

/** L'état que le SDK rapporte, s'il en rapporte un ; un message sans état, ou à état inconnu, ne dit rien. */
export function etatRapideLu(msg: unknown): EtatRapideLu | null {
  if (!estObjet(msg)) return null;
  const etat = EtatRapideSdk.safeParse(msg['fast_mode_state']);
  if (!etat.success) return null;
  const raison = msg['fast_mode_disabled_reason'];
  return { etat: etat.data, raison: typeof raison === 'string' && raison !== '' ? raison : null };
}

/** La raison à montrer : `sdk_opt_in_required` n'a de sens que si Chris a demandé le mode rapide. */
export function raisonRapide(demande: boolean, raison: string | null): string | null {
  return !demande && raison === RAISON_SANS_DEMANDE ? null : raison;
}

/** Mise à jour de l'état rapide après une lecture ; sans lecture, seule la compatibilité change (ou reste). */
export function rapideLu(
  anterieur: ModeRapide | undefined,
  lu: EtatRapideLu | null,
  compatible: boolean | null = anterieur?.compatible ?? null,
): ModeRapide {
  const base = anterieur ?? rapideDefaut();
  if (!lu) return { ...base, compatible };
  return { ...base, compatible, etat: lu.etat, raison: raisonRapide(base.demande, lu.raison) };
}

/** Après une bascule : en attente du rapport du SDK si on l'active, éteint sinon. */
export function rapideBascule(anterieur: ModeRapide | undefined, actif: boolean): ModeRapide {
  return { demande: actif, etat: actif ? null : 'off', raison: null, compatible: anterieur?.compatible ?? null };
}

/** Compatibilité du modèle voulu avec le mode rapide, lue dans la liste du SDK ; null si inconnue. */
export function compatibleRapide(voulu: string, modeles: readonly ModeleModes[] | undefined): boolean | null {
  if (!modeles) return null;
  const identifiant = modeleEffectif(voulu, modeles);
  const entree =
    voulu === 'défaut'
      ? modeles.find((m) => m.value === 'default')
      : modeles.find((m) => m.value === voulu || m.resolvedModel === voulu);
  const trouvee =
    entree ??
    modeles.find((m) => m.value !== 'default' && (m.value === identifiant || m.resolvedModel === identifiant));
  return typeof trouvee?.supportsFastMode === 'boolean' ? trouvee.supportsFastMode : null;
}

/** Ultracode après une bascule : ce que le SDK applique fait foi ; sans lecture, on garde ce qui a été demandé. */
export function ultracodeBascule(actif: boolean, lus: ReglagesAppliques | null): ModeUltracode {
  return {
    demande: lus?.ultracodeRequested ?? actif,
    actif: lus?.ultracode ?? actif,
    disponible: lus?.ultracodeAvailable ?? null,
  };
}

/** Ultracode relevé à l'initialisation ou après un changement de modèle : ce que le SDK applique l'emporte (une
 * session ouverte avec `settings.ultracode` le rapporte actif dès l'initialisation) ; champ absent : on garde l'état. */
export function ultracodeLu(anterieur: ModeUltracode, lus: ReglagesAppliques | null): ModeUltracode {
  return {
    demande: lus?.ultracodeRequested ?? anterieur.demande,
    actif: lus?.ultracode ?? anterieur.actif,
    disponible: lus?.ultracodeAvailable ?? null,
  };
}

/** `getSettings()` → réglages appliqués ; null si la réponse n'a pas la forme attendue. */
export function lireReglagesAppliques(retour: unknown): ReglagesAppliques | null {
  if (!estObjet(retour) || !estObjet(retour['applied'])) return null;
  const applique = retour['applied'];
  const ultracode = applique['ultracode'];
  const demandee = applique['ultracodeRequested'];
  const disponible = applique['ultracodeAvailable'];
  return {
    ...(typeof ultracode === 'boolean' ? { ultracode } : {}),
    ...(typeof demandee === 'boolean' ? { ultracodeRequested: demandee } : {}),
    ...(typeof disponible === 'boolean' ? { ultracodeAvailable: disponible } : {}),
  };
}
