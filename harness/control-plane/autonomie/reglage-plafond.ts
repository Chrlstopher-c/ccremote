/**
 * Responsabilité : le plafond d'autonomie d'un fil — comment il se règle, se
 * stocke et se résout. Pur, aucune I/O.
 *
 * `☠` Ce plafond était une CONSTANTE COMPILÉE (`AUTO_APPROBATIONS_MAX = 40`).
 * Le changer demandait un redéploiement du control plane, c'est-à-dire couper
 * l'orchestrateur en pleine conversation — donc en pratique il ne changeait
 * jamais, et un chantier légitime de plus de 40 équipes se heurtait à un mur
 * que personne ne pouvait déplacer à temps.
 *
 * `☠` Trois états DISTINCTS, et la distinction n'est pas cosmétique :
 *   · `herite`   — le fil ne dit rien, le défaut de parc s'applique ;
 *   · `illimite` — Chris a explicitement retiré le plafond DE CE FIL ;
 *   · `valeur`   — un maximum propre au fil.
 * Confondre « non réglé » et « illimité » sous un même `null` en base rendrait
 * impossible de distinguer un fil neuf d'un fil délibérément affranchi : baisser
 * le défaut de parc aurait alors reserré des fils que Chris avait ouverts à la
 * main, sans qu'aucune trace ne dise pourquoi.
 *
 * `☠` « Illimité » ne veut PAS dire « sans garde-fou ». Le garde-fou qui compte
 * reste le plafond de dépense du parc (H-58), appliqué en amont et hors d'atteinte
 * de ce réglage : un fil illimité peut enchaîner les équipes, il ne peut pas
 * dépasser le budget du parc.
 */

/** Ce qu'un fil déclare — jamais ce qui s'applique : voir `plafondEffectif`. */
export type ReglagePlafond =
  | { readonly type: 'herite' }
  | { readonly type: 'illimite' }
  | { readonly type: 'valeur'; readonly max: number };

export const HERITE: ReglagePlafond = { type: 'herite' };

/** Forme stockée en base, colonne `conversation.plafond_autonomie` (migration 26). */
export const JETON_ILLIMITE = 'illimite';

export class ErreurPlafondInvalide extends Error {
  constructor(recu: string) {
    // Le destinataire est un modèle (outil MCP) ou un opérateur : le refus doit
    // porter les valeurs acceptées, sinon il réémet la même chose au tour suivant.
    super(
      `plafond d'autonomie invalide : « ${recu} ». Valeurs acceptées : un entier strictement ` +
        `positif (nombre d'équipes lançables sans clic), « ${JETON_ILLIMITE} » pour retirer le ` +
        'plafond de ce fil, ou rien du tout pour hériter du défaut du parc.',
    );
    this.name = 'ErreurPlafondInvalide';
  }
}

/**
 * Relit la colonne. `null` en base ⇒ `herite` : une conversation d'avant la
 * migration 26 n'a jamais rien réglé, elle ne doit pas se retrouver illimitée.
 */
export function lireReglagePlafond(brut: string | null): ReglagePlafond {
  if (brut === null || brut === '') return HERITE;
  if (brut === JETON_ILLIMITE) return { type: 'illimite' };
  const max = Number.parseInt(brut, 10);
  // `☠` Une ligne illisible ne fait PAS lever au milieu d'une lecture de fil :
  // elle retombe sur le défaut de parc, le comportement le plus conservateur.
  // Lever ici transformerait une donnée douteuse en panne de l'orchestrateur.
  if (!Number.isSafeInteger(max) || max <= 0) return HERITE;
  return { type: 'valeur', max };
}

/** Forme à écrire en base pour un réglage. `null` ⇒ la colonne redevient vide. */
export function ecrireReglagePlafond(reglage: ReglagePlafond): string | null {
  if (reglage.type === 'herite') return null;
  if (reglage.type === 'illimite') return JETON_ILLIMITE;
  return String(reglage.max);
}

/**
 * Normalise ce qu'un appelant humain ou un modèle a écrit. Toute valeur venue
 * d'un LLM est une entrée non fiable : validée AVANT écriture, jamais au point
 * d'usage (`rules/code-standards.md`).
 */
export function normaliserReglagePlafond(recu: string | number | null | undefined): ReglagePlafond {
  if (recu === null || recu === undefined) return HERITE;
  if (typeof recu === 'number') {
    if (!Number.isSafeInteger(recu) || recu <= 0) throw new ErreurPlafondInvalide(String(recu));
    return { type: 'valeur', max: recu };
  }
  const propre = recu.trim().toLowerCase();
  if (propre === '') return HERITE;
  if (propre === JETON_ILLIMITE || propre === 'illimité' || propre === 'aucun') return { type: 'illimite' };
  const max = Number.parseInt(propre, 10);
  if (!Number.isSafeInteger(max) || max <= 0 || String(max) !== propre) throw new ErreurPlafondInvalide(recu);
  return { type: 'valeur', max };
}

/**
 * Ce qui s'applique RÉELLEMENT à ce fil. `null` ⇒ aucun plafond d'autonomie.
 *
 * `☠` Le défaut de parc peut lui-même être `null` (parc entier affranchi) : un
 * fil en `herite` devient alors illimité par héritage, ce qui est la lecture
 * voulue — le réglage de parc est le seul endroit à changer pour tout ouvrir.
 */
export function plafondEffectif(reglageFil: ReglagePlafond, defautParc: number | null): number | null {
  if (reglageFil.type === 'illimite') return null;
  if (reglageFil.type === 'valeur') return reglageFil.max;
  return defautParc;
}

/**
 * Défaut de PARC lu depuis l'environnement (`CCREMOTE_PI_PLAFOND_AUTONOMIE`).
 * Absent ⇒ `undefined`, c'est-à-dire la valeur d'usine ; `illimite` ⇒ `null`.
 *
 * `☠` Distinguer les deux est ce qui permet à Chris d'affranchir le parc entier
 * par une variable d'environnement, sans toucher au code ni à un seul fil.
 * Une valeur illisible LÈVE au démarrage plutôt que de retomber en silence sur
 * 40 : un réglage de parc qu'on croit posé et qui ne l'est pas est exactement le
 * genre de panne qui ne se découvre qu'au moment où elle coûte cher.
 */
export function lirePlafondAutonomieParc(brut: string | undefined): number | null | undefined {
  if (brut === undefined || brut.trim() === '') return undefined;
  const reglage = normaliserReglagePlafond(brut);
  if (reglage.type === 'illimite') return null;
  // `herite` est impossible ici : la chaîne vide est déjà partie plus haut.
  return reglage.type === 'valeur' ? reglage.max : undefined;
}

/** Phrase destinée à l'orchestrateur — jamais un code. */
export function decrirePlafond(effectif: number | null): string {
  return effectif === null ? 'aucun plafond (illimité)' : `${effectif} équipe(s) sans clic`;
}
