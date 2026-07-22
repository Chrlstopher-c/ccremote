/**
 * Responsabilité : garantir MÉCANIQUEMENT le principe A.2.1 « tout outil rend la
 * main immédiatement » — pas par discipline d'écriture (acceptation (a)).
 *
 * Le risque n'est pas seulement « un développeur oublie un await » : c'est que
 * n'importe quel port (transport D, worker B) peut, un jour, se mettre à
 * bloquer (lien coupé, worker qui ne répond plus). Si un handler d'outil
 * attendait directement cette promesse, l'orchestrateur entier se figerait.
 *
 * `avecPlafond` fait courir la promesse du port contre un délai fixe. Si le
 * délai gagne, l'appelant reçoit `{ etat: 'delai_depasse' }` — jamais une
 * attente indéfinie — et peut construire un `effet: 'accepte'` plutôt que
 * `'applique'` : la demande est partie, sa confirmation ne l'est pas encore.
 *
 * ☠ Ne PAS annuler la promesse sous-jacente : on n'a aucune garantie qu'un
 * port l'implémente proprement, et ce n'est pas le rôle de cette fonction —
 * elle borne l'ATTENTE de l'appelant, pas le travail en cours côté port.
 */

export type ResultatPlafonne<T> =
  | { readonly etat: 'resolu'; readonly valeur: T }
  | { readonly etat: 'delai_depasse' };

/** Délai par défaut pour un appel de port depuis un outil de contrôle (A.2.1). */
export const PLAFOND_PORT_MS_DEFAUT = 3000;

export async function avecPlafond<T>(
  promesse: Promise<T>,
  plafondMs: number = PLAFOND_PORT_MS_DEFAUT,
): Promise<ResultatPlafonne<T>> {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<ResultatPlafonne<T>>((resolve) => {
    minuteur = setTimeout(() => resolve({ etat: 'delai_depasse' }), plafondMs);
  });
  try {
    return await Promise.race([promesse.then((valeur): ResultatPlafonne<T> => ({ etat: 'resolu', valeur })), delai]);
  } finally {
    if (minuteur !== undefined) clearTimeout(minuteur);
  }
}
