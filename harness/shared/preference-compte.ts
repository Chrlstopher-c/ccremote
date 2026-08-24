/**
 * Responsabilité : appliquer le CHOIX MANUEL de compte de l'opérateur, et son
 * verrou, aux deux endroits qui décident d'un compte — l'orchestrateur maître
 * (`choix-compte-orchestrateur.ts`) et le dispatch d'équipe
 * (`dispatch-mandat.ts`). Logique pure, aucun accès au registre : les deux
 * appelants n'ont pas la même forme de liste, ils ont la même RÈGLE.
 *
 * `☠ POURQUOI CE MODULE EXISTE.` Mesuré le 24/08 : le harness annonçait
 * « abonnement fini » sur un compte que Chris avait remplacé huit jours plus
 * tôt. Le registre portait encore `compte-b = compte-b@exemple.fr,
 * status: rejected, fenêtre 5 h « expirée »` — un verdict figé sur une fenêtre
 * morte — et rien dans l'interface ne permettait de dire « prends celui-là ».
 * L'opérateur pouvait constater le mauvais choix, jamais le corriger.
 *
 * `☠` Le verrou est STRICT, et c'est délibéré : verrouillé, on ne bascule pas,
 * même quand le compte choisi vient de heurter son mur. Une bascule « pour
 * rendre service » est exactement ce qui a rendu l'incident illisible — le
 * harness changeait de compte sans que personne l'ait demandé. Le prix est
 * assumé : équipe bloquée jusqu'au reset de fenêtre, et l'écran doit le DIRE
 * plutôt que de le laisser découvrir.
 */

/** Ce que ce module a besoin de savoir d'une préférence. */
export interface PreferenceAppliquee {
  readonly compteId: string | null;
  readonly verrouille: boolean;
}

/**
 * Ce qu'on décide face à une liste de candidats ordonnée.
 *
 * `☠` `automatique` porte un motif : « aucune préférence » et « préférence
 * inapplicable parce que le compte a disparu de l'inventaire » produisent le
 * même comportement mais ne sont pas la même information. Les confondre, c'est
 * reproduire le silence qui a coûté cette session.
 */
export type ResolutionPreference =
  | { readonly mode: 'automatique'; readonly motif: MotifAutomatique }
  | { readonly mode: 'preferee'; readonly index: number; readonly verrouille: boolean };

export type MotifAutomatique =
  | 'aucune-preference'
  | 'compte-prefere-absent-de-la-liste'
  | 'compte-prefere-sature-et-non-verrouille';

/**
 * Où se trouve le compte préféré dans `candidats`, ou `-1`.
 *
 * `idDe` rend `null` pour un candidat dont l'identité n'a pas pu être lue (un
 * dossier de config sans `.claude.json`, par exemple) : un tel candidat ne
 * correspond à aucune préférence, il n'est jamais retenu par erreur.
 */
export function indexDuPrefere<T>(
  candidats: readonly T[],
  idDe: (candidat: T) => string | null,
  compteId: string | null,
): number {
  if (compteId === null) return -1;
  return candidats.findIndex((c) => idDe(c) === compteId);
}

/**
 * La règle, en un seul endroit.
 *
 * `estSature` n'est consulté QUE hors verrou : verrouillé, la saturation ne
 * change rien — c'est tout l'objet du verrou.
 */
export function resoudrePreference<T>(
  candidats: readonly T[],
  idDe: (candidat: T) => string | null,
  preference: PreferenceAppliquee,
  estSature: (candidat: T) => boolean,
): ResolutionPreference {
  if (preference.compteId === null) return { mode: 'automatique', motif: 'aucune-preference' };

  const index = indexDuPrefere(candidats, idDe, preference.compteId);
  if (index === -1) return { mode: 'automatique', motif: 'compte-prefere-absent-de-la-liste' };

  const candidat = candidats[index];
  if (preference.verrouille) return { mode: 'preferee', index, verrouille: true };
  if (candidat !== undefined && estSature(candidat)) {
    return { mode: 'automatique', motif: 'compte-prefere-sature-et-non-verrouille' };
  }
  return { mode: 'preferee', index, verrouille: false };
}

/** Ce que la validation a besoin de savoir d'un compte enregistré. */
export interface CompteValidable {
  readonly id: string;
  readonly email: string | null;
  /** `null` ⇒ aucun jeton jamais relevé pour ce compte. */
  readonly jetonExpireA: number | null;
}

export type VerdictPreference =
  | { readonly ok: true; readonly avertissement: string | null }
  | { readonly ok: false; readonly raison: string };

/**
 * Refuse AVANT la première écriture un choix que le harness ne saurait pas
 * honorer, et le refuse de façon ACTIONNABLE — le message porte la liste des
 * valeurs acceptées, parce qu'un refus sans liste condamne l'appelant (humain
 * ou modèle) à rejouer la même valeur.
 *
 * `☠` Un jeton EXPIRÉ n'est pas un refus, seulement un avertissement. Les
 * jetons du registre vivent ~8 h et ne sont re-relevés que PC allumé : refuser
 * sur expiration rendrait le réglage impossible chaque fois que le PC dort,
 * c'est-à-dire précisément quand on veut le régler à distance. C'est le même
 * piège que le `rejected` figé qui a motivé ce module — un verdict tiré d'une
 * fenêtre ne doit pas survivre à cette fenêtre.
 *
 * `☠` En revanche, un jeton JAMAIS relevé est dit : c'est le signal réel d'un
 * compte qui n'a pas de session valide derrière lui — le cas du `compte-b` du
 * VPS, dont le `.credentials.json` existait avec un `accessToken` vide, et que
 * `decouvrirComptes()` annonçait pourtant disponible.
 */
export function validerPreference(
  compteId: string | null,
  connus: readonly CompteValidable[],
  maintenant: number = Date.now(),
): VerdictPreference {
  if (compteId === null) return { ok: true, avertissement: null };

  const compte = connus.find((c) => c.id === compteId);
  if (compte === undefined) {
    const acceptes = connus.map((c) => c.id).join(', ');
    return {
      ok: false,
      raison:
        connus.length === 0
          ? 'aucun compte n’est enregistré au registre — impossible d’en choisir un'
          : `compte inconnu : « ${compteId} ». Valeurs acceptées : ${acceptes}, ` +
            'ou null pour rendre la main à l’automatique',
    };
  }

  if (compte.jetonExpireA === null) {
    return {
      ok: true,
      avertissement:
        `aucun jeton n’a jamais été relevé pour « ${compteId} » — le harness ne saura pas mesurer ` +
        'ses quotas, et une équipe lancée dessus peut échouer au démarrage',
    };
  }
  if (compte.jetonExpireA <= maintenant) {
    return {
      ok: true,
      avertissement:
        `le jeton de « ${compteId} » a expiré — il sera renouvelé au prochain relevé, ` +
        'machine de travail allumée',
    };
  }
  return { ok: true, avertissement: null };
}
