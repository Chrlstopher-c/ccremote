/**
 * Responsabilité : l'enveloppe de toute réponse de l'API web du harness.
 *
 * `☠` LE point transversal de H-75, et la raison pour laquelle cette enveloppe
 * existe plutôt qu'un simple JSON : **l'absence du PC n'est pas une erreur.**
 * Le PC peut être éteint toute la nuit — c'est le régime nominal, pas une
 * panne. Répondre 503 dans ce cas ferait afficher « erreur » à une interface
 * qui devrait afficher « PC éteint, voici ce qu'on savait à 23 h 14 ».
 *
 * Trois états, jamais deux :
 *  - PC là, données fraîches  → `pcOnline: true,  stale: false`
 *  - PC absent, données connues → `pcOnline: false, stale: true` + `data`
 *  - PC absent, rien de connu   → `pcOnline: false, stale: true` + `data: null`
 *
 * Une VRAIE panne (le control plane lui-même échoue) reste un code HTTP
 * d'erreur — la distinction est le tout de ce fichier. Les confondre est
 * exactement ce qui rendrait l'interface inutilisable la moitié du temps.
 */

export interface Enveloppe<T> {
  readonly pcOnline: boolean;
  readonly stale: boolean;
  readonly data: T | null;
  readonly message?: string;
}

/** Message affiché tel quel par l'interface — jamais un jargon d'erreur. */
const MESSAGE_PC_ABSENT = "PC absent — dernières données connues, pas d'erreur.";

/**
 * Construit l'enveloppe. `pcOnline` vient du lien réel, jamais d'une supposition.
 *
 * `☠` Les données du registre restent servies quand le PC est absent : elles
 * sont persistées côté Pi et gardent leur valeur d'affichage. Elles sont alors
 * marquées `stale` — ce qui est la vérité, et ce que l'interface a besoin de
 * savoir pour ne pas laisser croire à du temps réel.
 */
export function enveloppe<T>(pcOnline: boolean, data: T | null): Enveloppe<T> {
  if (pcOnline) return { pcOnline: true, stale: false, data };
  return { pcOnline: false, stale: true, data, message: MESSAGE_PC_ABSENT };
}

/**
 * Erreur applicative volontaire, distincte de l'absence du PC. Portée par un
 * type dédié pour qu'aucun chemin ne puisse la confondre avec un `pcOnline:
 * false` — la confusion irait dans le sens coûteux : afficher « tout va bien,
 * données un peu vieilles » alors que le control plane est cassé.
 */
export class ErreurApi extends Error {
  constructor(
    readonly statut: number,
    message: string,
  ) {
    super(message);
    this.name = 'ErreurApi';
  }
}

export function introuvable(quoi: string): ErreurApi {
  return new ErreurApi(404, `${quoi} introuvable`);
}

export function requeteInvalide(detail: string): ErreurApi {
  return new ErreurApi(400, detail);
}
