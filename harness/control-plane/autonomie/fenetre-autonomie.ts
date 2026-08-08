/**
 * Responsabilité : la FENÊTRE d'autonomie d'un fil (migration 15) — comment un
 * instant s'écrit, quelles bornes une plage doit respecter, et si un changement
 * demandé ÉLARGIT ou RESSERRE l'autonomie existante. Pur, aucune I/O.
 *
 * `☠` Ce module existe parce qu'une fenêtre est exactement ce qui dispense
 * l'orchestrateur de demander l'autorisation. Il peut donc la RESSERRER seul
 * (avancer la fin, préciser l'objectif, baisser son plafond) — ces gestes lui
 * retirent du pouvoir. Il ne peut pas l'ÉLARGIR seul : ouvrir une fenêtre là où
 * il n'y en a pas, repousser une échéance ou monter un plafond passe par une
 * demande que Chris tranche d'un clic.
 *
 * `☠` L'arbitrage porte sur la VALEUR comparée à l'existant, jamais sur le nom
 * de l'outil appelé. Une garde qui ferait confiance à « l'outil ajuster ne peut
 * qu'ajuster » se contourne en une ligne de prompt : il suffit d'appeler
 * `ajuster` avec une fin plus lointaine. C'est `natureFin` et `naturePlafond`
 * ci-dessous qui tranchent, à partir des chiffres, et elles sont les seules.
 *
 * `☠` Un instant reçu d'un modèle est une entrée utilisateur au même titre
 * qu'un champ de formulaire (`rules/code-standards.md`) : normalisé et validé
 * AVANT toute écriture, et refusé avec la liste des formes acceptées — un refus
 * nu fait réémettre la même valeur au tour suivant.
 */

import type { ReglagePlafond } from './reglage-plafond.ts';

/** Une plage plus courte que ça ne laisse le temps de rien lancer. */
export const DUREE_FENETRE_MIN_MS = 5 * 60_000;

/**
 * Plafond de durée d'une plage. `☠` Bornée VOLONTAIREMENT : une fenêtre est un
 * chèque en blanc daté, et une date lointaine posée par erreur (« 2027 » au
 * lieu de « 2026 ») ne se remarque qu'au moment où elle a déjà servi. Quatorze
 * jours couvrent largement une nuit, un week-end ou un congé ; au-delà, la
 * plage se redemande.
 */
export const DUREE_FENETRE_MAX_MS = 14 * 24 * 60 * 60_000;

const FORMES_INSTANT =
  'Formes acceptées : « maintenant » ; un décalage relatif « +8h », « +90min », « +3j » ; ' +
  'un instant ISO 8601 AVEC l’heure (« 2026-08-09T02:00 », « 2026-08-09T02:00:00+02:00 », ' +
  '« 2026-08-09T00:00:00Z ») ; ou un horodatage epoch en millisecondes.';

export class ErreurInstantInvalide extends Error {
  constructor(recu: string, precision?: string) {
    super(`instant invalide : « ${recu} »${precision === undefined ? '' : ` — ${precision}`}. ${FORMES_INSTANT}`);
    this.name = 'ErreurInstantInvalide';
  }
}

export class ErreurFenetreInvalide extends Error {
  constructor(raison: string) {
    super(raison);
    this.name = 'ErreurFenetreInvalide';
  }
}

const RELATIF = /^\+\s*(\d{1,5})\s*(min|mn|m|h|j|d)$/;
/**
 * `☠` L'HEURE EST OBLIGATOIRE. « 2026-08-09 » seul est refusé, et ce n'est pas
 * de la rigidité : selon la lecture, ça veut dire le début OU la fin de cette
 * journée-là, et JavaScript tranche pour minuit UTC — une fenêtre décalée de
 * deux heures sur le Pi, dans le sens qui la ferme trop tôt.
 */
const ISO_AVEC_HEURE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;
const EPOCH_MS = /^\d{12,14}$/;

const MULTIPLICATEUR: Readonly<Record<string, number>> = {
  min: 60_000,
  mn: 60_000,
  m: 60_000,
  h: 3_600_000,
  j: 86_400_000,
  d: 86_400_000,
};

/** Décalage relatif (« +8h ») → instant absolu, ou `null` si ce n'en est pas un. */
function depuisRelatif(propre: string, maintenant: number): number | null {
  const relatif = RELATIF.exec(propre);
  if (relatif === null) return null;
  const [, quantite, unite] = relatif;
  const pas = MULTIPLICATEUR[unite ?? ''];
  if (quantite === undefined || pas === undefined) return null;
  return maintenant + Number.parseInt(quantite, 10) * pas;
}

/**
 * Normalise ce qu'un modèle (ou un opérateur) a écrit en horodatage epoch ms.
 * Lève `ErreurInstantInvalide` — jamais un `NaN` qui se propagerait en base.
 *
 * `☠` Un ISO sans fuseau (« 2026-08-09T02:00 ») est lu en heure LOCALE de la
 * machine, ce qui est la lecture attendue : l'orchestrateur écrit l'heure que
 * Chris lui a dite, et le Pi vit à son heure.
 */
export function normaliserInstant(recu: string | number, maintenant: number = Date.now()): number {
  if (typeof recu === 'number') {
    if (!Number.isFinite(recu) || !Number.isSafeInteger(recu)) throw new ErreurInstantInvalide(String(recu));
    return recu;
  }
  const propre = recu.trim();
  if (propre === '') throw new ErreurInstantInvalide('(vide)');
  const bas = propre.toLowerCase();
  if (bas === 'maintenant' || bas === 'now') return maintenant;

  const relatif = depuisRelatif(bas, maintenant);
  if (relatif !== null) return relatif;

  if (EPOCH_MS.test(propre)) return Number.parseInt(propre, 10);

  if (!ISO_AVEC_HEURE.test(propre)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(propre)) {
      throw new ErreurInstantInvalide(propre, "une date sans heure est ambiguë (début ou fin de journée ?)");
    }
    throw new ErreurInstantInvalide(propre);
  }
  const ms = Date.parse(propre);
  if (Number.isNaN(ms)) throw new ErreurInstantInvalide(propre, 'date inexistante au calendrier');
  return ms;
}

export interface Fenetre {
  readonly debut: number;
  readonly fin: number;
}

function heures(ms: number): string {
  return `${Math.round(ms / 3_600_000)} h`;
}

/**
 * Vérifie une plage AVANT toute écriture. Lève `ErreurFenetreInvalide` dont le
 * message nomme la valeur acceptable — l'appelant est un modèle, et un refus
 * qui ne dit pas quoi corriger le fait réessayer à l'identique.
 */
export function validerFenetre(debut: number, fin: number, maintenant: number = Date.now()): Fenetre {
  if (fin <= debut) {
    throw new ErreurFenetreInvalide(
      `la fin doit suivre le début — reçu début ${new Date(debut).toISOString()}, ` +
        `fin ${new Date(fin).toISOString()}. Une fenêtre qui se termine avant de commencer ne s'ouvre jamais.`,
    );
  }
  if (fin <= maintenant) {
    throw new ErreurFenetreInvalide(
      `la fin est déjà passée (${new Date(fin).toISOString()}, il est ${new Date(maintenant).toISOString()}) — ` +
        'donne une échéance future, ou ferme la fenêtre existante.',
    );
  }
  const duree = fin - debut;
  if (duree < DUREE_FENETRE_MIN_MS) {
    throw new ErreurFenetreInvalide(
      `plage trop courte (${Math.round(duree / 60_000)} min) — minimum ${DUREE_FENETRE_MIN_MS / 60_000} min.`,
    );
  }
  if (duree > DUREE_FENETRE_MAX_MS) {
    throw new ErreurFenetreInvalide(
      `plage trop longue (${heures(duree)}) — maximum ${heures(DUREE_FENETRE_MAX_MS)} (14 jours). ` +
        'Vérifie l’année et le jour, puis redemande une plage plus courte : elle se renouvelle.',
    );
  }
  if (debut > maintenant + DUREE_FENETRE_MAX_MS) {
    throw new ErreurFenetreInvalide(
      `début trop lointain (${new Date(debut).toISOString()}) — au plus ${heures(DUREE_FENETRE_MAX_MS)} devant nous.`,
    );
  }
  return { debut, fin };
}

/**
 * Ce qu'un changement fait au pouvoir du fil. `☠` C'est la garde entière : tout
 * ce qui n'est pas `restriction` (ou `inchange`) exige un clic de Chris.
 */
export type NatureChangement = 'restriction' | 'inchange' | 'extension';

/**
 * Une fin voulue face à la fin en vigueur. Aucune fenêtre en cours ⇒ toute fin
 * est une `extension` : passer de « rien » à « une plage » est la création même,
 * c'est-à-dire le geste qui donne le plus de pouvoir d'un coup.
 */
export function natureFin(finActuelle: number | null, finVoulue: number): NatureChangement {
  if (finActuelle === null) return 'extension';
  if (finVoulue < finActuelle) return 'restriction';
  if (finVoulue === finActuelle) return 'inchange';
  return 'extension';
}

/**
 * Un plafond voulu face au plafond EFFECTIF en vigueur (déjà résolu par
 * `plafondEffectif` : `null` ⇒ illimité).
 *
 * `☠` Comparer au réglage BRUT du fil serait faux : un fil en `herite` sous un
 * parc à 40 accepterait « 100 » comme une baisse, puisqu'il n'a « rien » réglé.
 * On compare toujours ce qui s'applique réellement.
 */
export function naturePlafond(effectifActuel: number | null, voulu: ReglagePlafond): NatureChangement {
  if (voulu.type === 'herite') return 'inchange';
  if (voulu.type === 'illimite') return effectifActuel === null ? 'inchange' : 'extension';
  if (effectifActuel === null) return 'restriction';
  if (voulu.max < effectifActuel) return 'restriction';
  return voulu.max === effectifActuel ? 'inchange' : 'extension';
}

/** Instant lisible dans une phrase destinée à l'orchestrateur ou à Chris. */
export function instantLisible(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR');
}
