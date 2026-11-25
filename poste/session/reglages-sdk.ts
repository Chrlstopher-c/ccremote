// Responsabilité : les réglages qu'on change en cours de session SDK (mode de permission, modèle, effort, titre,
// mode rapide, Ultracode) — leur application à la requête vivante et leur effet sur l'état de la session.
// Pur hors des appels à la requête.
import type { EffortLevel, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import type { DemandeSession, EffortSession, ResumeSession } from '../../commun/session.ts';
import {
  compatibleRapide,
  type EtatRapideLu,
  etatRapideLu,
  lireReglagesAppliques,
  type ModeleModes,
  type ReglagesAppliques,
  rapideBascule,
  ultracodeBascule,
  ultracodeDefaut,
} from './modes-sdk.ts';
import type { Reglage, SessionPoste } from './session-poste.ts';

export const MODELE_PAR_DEFAUT = 'défaut';

// Les réglages de mode (rapide, Ultracode) : ils passent par `basculerMode`, jamais par `appliquerReglage`.
export type ReglageMode = Extract<Reglage, { kind: 'rapide' | 'ultracode' }>;

// Ce que la requête vivante accepte en cours de route (le SDK les expose sur son objet `Query`).
export interface RequeteReglable {
  // Le SDK 0.3.332 rend la réponse de contrôle ; seule la fin de l'appel compte ici.
  setPermissionMode(mode: PermissionMode): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  applyFlagSettings(settings: {
    readonly effortLevel?: EffortLevel | null;
    readonly outputStyle?: string | null;
    readonly fastMode?: boolean;
    readonly ultracode?: boolean;
  }): Promise<void>;
  // get_settings : présent à l'exécution, absent des types publics du SDK (0.3.325 à 0.3.332).
  getSettings?(): Promise<unknown>;
}

// Ce que la requête rend à l'initialisation : modèles (avec le drapeau du mode rapide) et état du mode rapide.
export interface RequeteModes extends RequeteReglable {
  initializationResult(): Promise<{
    readonly models?: readonly ModeleModes[];
    readonly fast_mode_state?: unknown;
    readonly fast_mode_disabled_reason?: unknown;
  }>;
}

export async function appliquerReglage(requete: RequeteReglable, r: Reglage, ultracode: boolean): Promise<void> {
  if (r.kind === 'mode') {
    await requete.setPermissionMode(r.mode);
    return undefined;
  }
  if (r.kind === 'modele') return requete.setModel(r.modele === MODELE_PAR_DEFAUT ? undefined : r.modele);
  if (r.kind === 'effort') return requete.applyFlagSettings(reglageEffort(r.effort, ultracode));
  if (r.kind === 'style') return requete.applyFlagSettings({ outputStyle: r.style });
  return undefined;
}

// Un effort qui change de niveau coupe Ultracode, sauf si la clé `ultracode` part avec lui : elle reste donc envoyée.
export function reglageEffort(
  effort: EffortSession | null,
  ultracode: boolean,
): { readonly effortLevel: EffortSession | null; readonly ultracode?: true } {
  return ultracode ? { effortLevel: effort, ultracode: true } : { effortLevel: effort };
}

/** Les champs de l'état qu'un réglage change (le renommage ne touche qu'au titre ; modes : `basculerMode`). */
export function champsReglage(r: Reglage): Partial<ResumeSession> {
  if (r.kind === 'mode') return { mode: r.mode };
  if (r.kind === 'modele') return { modele: r.modele };
  if (r.kind === 'effort') return { effort: r.effort };
  if (r.kind === 'style') return { style_sortie: r.style };
  if (r.kind === 'rapide' || r.kind === 'ultracode') return {};
  return { titre: r.titre };
}

// Mode rapide ou Ultracode : appliqué à la requête vivante s'il y en a une (un refus du SDK remonte), sinon gardé
// pour la prochaine ouverture ou reprise. Rend les champs de la fiche à écrire.
export async function basculerMode(
  requete: RequeteReglable | null,
  r: ReglageMode,
  etat: ResumeSession,
  journal: Logger,
): Promise<Partial<ResumeSession>> {
  if (r.kind === 'rapide') {
    if (requete) await requete.applyFlagSettings({ fastMode: r.actif });
    return { rapide: rapideBascule(etat.rapide, r.actif) };
  }
  const anterieur = etat.ultracode ?? ultracodeDefaut();
  if (!requete) return { ultracode: { ...anterieur, demande: r.actif, actif: false } };
  await requete.applyFlagSettings({ ultracode: r.actif });
  return { ultracode: ultracodeBascule(r.actif, await lireApplique(requete, journal, etat.id)) };
}

/** Réglages appliqués relus dans la requête ; un échec est journalisé et rendu comme « inconnu ». */
export async function lireApplique(
  requete: RequeteReglable,
  journal: Logger,
  session: string,
): Promise<ReglagesAppliques | null> {
  if (!requete.getSettings) return null;
  try {
    return lireReglagesAppliques(await requete.getSettings());
  } catch (erreur) {
    journal.warn({ err: erreur, session }, 'réglages appliqués non lus dans la requête');
    return null;
  }
}

export interface ModesLus {
  readonly rapide: EtatRapideLu | null;
  readonly compatible: boolean | null;
  readonly reglages: ReglagesAppliques | null;
}

// Relevé à l'initialisation et après un changement de modèle : état rapide, compatibilité, dispo d'Ultracode.
export async function lireModes(
  requete: RequeteModes,
  modele: string,
  journal: Logger,
  session: string,
): Promise<ModesLus> {
  let init: Awaited<ReturnType<RequeteModes['initializationResult']>> | null = null;
  try {
    init = await requete.initializationResult();
  } catch (erreur) {
    journal.warn({ err: erreur, session }, 'initialisation non lue : modes non relevés');
  }
  return {
    rapide: init ? etatRapideLu(init) : null,
    compatible: compatibleRapide(modele, init?.models),
    reglages: await lireApplique(requete, journal, session),
  };
}

// Mode rapide et Ultracode demandés à l'ouverture : état de départ de la fiche (les options les portent aussi).
export function modesDeOuverture(d: DemandeSession): Pick<ResumeSession, 'rapide' | 'ultracode'> {
  return {
    ...(d.rapide ? { rapide: rapideBascule(undefined, true) } : {}),
    ...(d.ultracode ? { ultracode: { ...ultracodeDefaut(), demande: true } } : {}),
  };
}

// Mode, modèle et effort voulus à l'ouverture s'appliquent avant le premier message (SDK seulement) ; rend le refus éventuel.
export async function reglagesDeOuverture(session: SessionPoste, d: DemandeSession): Promise<string | null> {
  if (d.pieces?.length && (d.moteur ?? 'sdk') !== 'sdk') return 'pièces jointes : moteur SDK seulement';
  if ((d.rapide || d.ultracode) && (d.moteur ?? 'sdk') !== 'sdk') {
    return 'mode rapide et Ultracode : moteur SDK seulement';
  }
  if ((d.moteur ?? 'sdk') !== 'sdk') return null;
  const reglages: Reglage[] = [];
  if (d.mode && d.mode !== 'bypassPermissions') reglages.push({ kind: 'mode', mode: d.mode });
  if (d.modele) reglages.push({ kind: 'modele', modele: d.modele });
  if (d.effort) reglages.push({ kind: 'effort', effort: d.effort });
  for (const reglage of reglages) {
    const refus = await session.reglerSession(reglage);
    if (refus) return refus;
  }
  return null;
}
