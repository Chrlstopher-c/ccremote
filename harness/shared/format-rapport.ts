/**
 * Responsabilité : le format opposable du rapport de fin de mission — les marqueurs que
 * `BLOC_RAPPORT` impose au lead (dispatch-mandat.ts) et que `rapport_equipe` (outils-inspection.ts)
 * essaie d'extraire. Un seul fichier pour les deux côtés : un marqueur renommé d'un côté sans
 * l'autre romprait la structuration en silence — c'est justement le défaut mesuré (cause 4/5,
 * AUDIT-QUOTAS-QUALITE.md) qu'on corrige.
 *
 * `☠` PAS d'appel LLM ici (décision explicite, cf. B3) : extraction par marqueurs littéraux en
 * début de ligne, aucune inférence de sens. Un lead qui ne respecte pas le format dégrade vers le
 * texte brut — jamais un refus, jamais une exception.
 */

/** Rubriques, dans l'ordre imposé au lead. Le libellé EST le marqueur cherché en tête de ligne. */
export const MARQUEUR_ETAT = 'RAPPORT_ETAT';
export const MARQUEUR_CHANGEMENTS = 'RAPPORT_CHANGEMENTS';
export const MARQUEUR_VERIFICATIONS = 'RAPPORT_VERIFICATIONS';
export const MARQUEUR_OUVERT = 'RAPPORT_OUVERT';

/** Libellé humain affiché devant chaque rubrique dans le rapport structuré rendu à l'orchestrateur. */
const LIBELLES: Readonly<Record<string, string>> = {
  [MARQUEUR_ETAT]: 'Critère d’arrêt',
  [MARQUEUR_CHANGEMENTS]: 'Changements',
  [MARQUEUR_VERIFICATIONS]: 'Vérifications',
  [MARQUEUR_OUVERT]: 'Reste ouvert',
};

/** Ordre imposé — sert à la fois au prompt (BLOC_RAPPORT) et au parseur. */
export const RUBRIQUES_RAPPORT = [
  MARQUEUR_ETAT,
  MARQUEUR_CHANGEMENTS,
  MARQUEUR_VERIFICATIONS,
  MARQUEUR_OUVERT,
] as const;

export interface RapportStructure {
  readonly etat: string;
  readonly changements: string;
  readonly verifications: string;
  readonly ouvert: string;
}

/**
 * Cherche les quatre marqueurs en tête de ligne (espaces de tête tolérés, ':' optionnel après le
 * marqueur) et découpe le texte en rubriques. Rend `null` dès qu'une rubrique manque ou est vide
 * après découpe — c'est le signal « format incomplet » pour l'appelant, qui dégrade alors vers le
 * texte brut plutôt que de rendre une structure à trous.
 */
export function extraireRubriquesRapport(texte: string): RapportStructure | null {
  const motif = new RegExp(`^[ \\t]*(${RUBRIQUES_RAPPORT.join('|')})[ \\t]*:?[ \\t]*`, 'gm');
  const occurrences: Array<{ marqueur: string; debut: number; finEntete: number }> = [];
  for (const trouve of texte.matchAll(motif)) {
    const marqueur = trouve[1];
    if (trouve.index === undefined || marqueur === undefined) continue;
    occurrences.push({ marqueur, debut: trouve.index, finEntete: trouve.index + trouve[0].length });
  }
  if (occurrences.length < RUBRIQUES_RAPPORT.length) return null;

  const contenuPar: Record<string, string> = {};
  for (const [i, occ] of occurrences.entries()) {
    // Une rubrique répétée écrase la précédente : on ne garde que la dernière occurrence, au cas
    // où le lead se corrige en cours de message.
    const suivante = occurrences[i + 1];
    const fin = suivante !== undefined ? suivante.debut : texte.length;
    contenuPar[occ.marqueur] = texte.slice(occ.finEntete, fin).trim();
  }

  const manquantOuVide = RUBRIQUES_RAPPORT.some((m) => !contenuPar[m]);
  if (manquantOuVide) return null;

  // `☠` `contenuPar[m]` est déjà garanti non vide par `manquantOuVide` ci-dessus — `??` couvre
  // uniquement l'imprécision de type de l'index signature, jamais un cas réel de valeur absente.
  return {
    etat: contenuPar[MARQUEUR_ETAT] ?? '',
    changements: contenuPar[MARQUEUR_CHANGEMENTS] ?? '',
    verifications: contenuPar[MARQUEUR_VERIFICATIONS] ?? '',
    ouvert: contenuPar[MARQUEUR_OUVERT] ?? '',
  };
}

/** Rend une `RapportStructure` lisible pour l'orchestrateur, rubrique par rubrique. */
export function formaterRapportStructure(rapport: RapportStructure): string {
  return RUBRIQUES_RAPPORT.map((m) => {
    const cle = m as keyof typeof MARQUEUR_TO_CHAMP;
    const champ = MARQUEUR_TO_CHAMP[cle];
    return `## ${LIBELLES[m]}\n${rapport[champ]}`;
  }).join('\n\n');
}

const MARQUEUR_TO_CHAMP = {
  [MARQUEUR_ETAT]: 'etat',
  [MARQUEUR_CHANGEMENTS]: 'changements',
  [MARQUEUR_VERIFICATIONS]: 'verifications',
  [MARQUEUR_OUVERT]: 'ouvert',
} as const satisfies Record<string, keyof RapportStructure>;
