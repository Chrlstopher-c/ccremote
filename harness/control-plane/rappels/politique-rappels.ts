/**
 * Responsabilité : ce qu'un rappel a le droit d'être, et quand il a le droit de
 * tirer. Pur, aucune I/O.
 *
 * `☠` Ces bornes ne sont pas de la prudence décorative. Un rappel est la
 * première chose de ce harness qui consomme du quota SANS que personne ne l'ait
 * demandé sur le moment : il réveille une session Opus, tout seul, en boucle.
 * Sans borne, « toutes les 10 minutes » devient « toutes les 10 secondes » sur
 * une faute de frappe d'un modèle, et la nuit est brûlée avant qu'on s'en
 * aperçoive. Ce module existe pour que ça reste impossible.
 */

/**
 * Période minimale entre deux tirs.
 *
 * `☠` Cinq minutes, et pas moins : chaque tir réveille une session, qui coûte à
 * la fois du quota et un tour de contexte à l'orchestrateur. À une minute, il
 * passerait sa vie à répondre à ses propres rappels au lieu de travailler.
 */
export const PERIODE_MIN_MS = 5 * 60_000;

/** Au-delà d'une semaine, ce n'est plus un rappel, c'est un projet. */
export const PERIODE_MAX_MS = 7 * 24 * 3_600_000;

/**
 * Rappels actifs simultanés PAR CONVERSATION.
 *
 * `☠` Par fil, jamais global : Chris doit pouvoir mener une veille dans un fil
 * et un chantier dans un autre sans que l'un rationne l'autre.
 */
export const RAPPELS_ACTIFS_MAX = 8;

/** Délai minimal avant le premier tir — un rappel n'est pas un message immédiat. */
export const PREMIER_TIR_MIN_MS = 30_000;

export interface DemandeRappel {
  readonly libelle: string;
  readonly consigne: string;
  /** Période en minutes, telle qu'un modèle l'exprime. `null` ⇒ tir unique. */
  readonly periodeMinutes: number | null;
  /** Délai avant le premier tir, en minutes. Absent ⇒ une période. */
  readonly premierTirDansMinutes?: number | null;
  readonly maxDeclenchements?: number | null;
}

export type VerdictRappel =
  | { readonly ok: true; readonly prochaineA: number; readonly periodeMs: number | null }
  | { readonly ok: false; readonly raison: string };

/**
 * Valide une demande et calcule sa première échéance.
 *
 * `☠` Le refus est rédigé POUR UN MODÈLE : il nomme la borne et la valeur
 * acceptable la plus proche. Un refus nu (« période invalide ») fait réessayer
 * la même valeur au tour suivant — mesuré sur ce dépôt avec les noms de modèles.
 */
export function validerRappel(
  demande: DemandeRappel,
  actifsDeja: number,
  maintenant: number = Date.now(),
): VerdictRappel {
  if (demande.libelle.trim().length === 0) return { ok: false, raison: 'libellé vide — donne un nom court au rappel' };
  if (demande.consigne.trim().length === 0) {
    return {
      ok: false,
      raison:
        'consigne vide : elle sera injectée telle quelle dans ce fil au déclenchement. ' +
        'Écris-la comme une instruction que tu te donnes à toi-même.',
    };
  }

  if (actifsDeja >= RAPPELS_ACTIFS_MAX) {
    return {
      ok: false,
      raison:
        `cette conversation a déjà ${actifsDeja} rappels actifs (maximum ${RAPPELS_ACTIFS_MAX}). ` +
        'Annule-en un avec `annuler_rappel` avant d’en poser un autre, ou regroupe deux ' +
        'consignes en une.',
    };
  }

  let periodeMs: number | null = null;
  if (demande.periodeMinutes !== null && demande.periodeMinutes !== undefined) {
    periodeMs = Math.round(demande.periodeMinutes * 60_000);
    if (periodeMs < PERIODE_MIN_MS) {
      return {
        ok: false,
        raison:
          `période de ${demande.periodeMinutes} min trop courte — minimum ${PERIODE_MIN_MS / 60_000} min. ` +
          'Chaque tir réveille une session et consomme du quota : en dessous, tu passerais ton ' +
          'temps à répondre à tes propres rappels.',
      };
    }
    if (periodeMs > PERIODE_MAX_MS) {
      return {
        ok: false,
        raison: `période trop longue — maximum ${PERIODE_MAX_MS / 3_600_000 / 24} jours. Au-delà, dis-le à Chris.`,
      };
    }
  }

  const premierMs =
    demande.premierTirDansMinutes !== null && demande.premierTirDansMinutes !== undefined
      ? Math.round(demande.premierTirDansMinutes * 60_000)
      : (periodeMs ?? PREMIER_TIR_MIN_MS);

  if (premierMs < PREMIER_TIR_MIN_MS) {
    return {
      ok: false,
      raison:
        `premier tir dans ${Math.round(premierMs / 1000)} s : trop tôt, minimum ` +
        `${PREMIER_TIR_MIN_MS / 1000} s. Un rappel n’est pas un message immédiat — si tu veux ` +
        'agir maintenant, fais-le maintenant.',
    };
  }

  return { ok: true, prochaineA: maintenant + premierMs, periodeMs };
}

/**
 * Un rappel peut-il tirer, vu l'état du carburant ?
 *
 * `☠` Le seul garde-fou qui compte réellement sur la durée. Un rappel récurrent
 * tire indéfiniment ; sans cette porte, il continuerait de réveiller une session
 * Opus alors que la fenêtre 5 h est saturée — c'est-à-dire en basculant sur du
 * surcoût PAYANT (H-63.1 : `rejected` ne coupe pas la session, elle continue et
 * elle est facturée).
 */
export function peutTirer(utilisationPireCompte: number | null, aucunCompteDisponible: boolean): VerdictTir {
  if (aucunCompteDisponible) {
    return { tire: false, raison: 'tous les comptes sont saturés — tir reporté' };
  }
  if (utilisationPireCompte !== null && utilisationPireCompte >= SEUIL_REPORT_PCT) {
    return {
      tire: false,
      raison: `carburant à ${utilisationPireCompte} % (seuil ${SEUIL_REPORT_PCT} %) — tir reporté`,
    };
  }
  return { tire: true };
}

/**
 * `☠` Plus bas que le seuil « critique » de `carburant_parc` (90 %) : un rappel
 * est du travail de fond, il doit céder la place au travail demandé bien avant
 * que celui-ci ne soit menacé.
 */
export const SEUIL_REPORT_PCT = 80;

/** De combien on repousse un tir qui n'a pas pu avoir lieu. */
export const REPORT_MS = 15 * 60_000;

export type VerdictTir = { readonly tire: true } | { readonly tire: false; readonly raison: string };
