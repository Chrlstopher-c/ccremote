// Responsabilité : un modèle daté — l'identifiant vu dans une conversation et l'instant où il l'a été. Entre les
// sources (transcript, fiche Claude Desktop, changement reçu par Remote Control), le plus récent gagne. Un instant
// absent perd contre un instant connu.
export interface ModeleDate {
  readonly modele: string;
  readonly le: string | null; // ISO 8601 ; null : instant inconnu (valeur lue dans une liste, sans date)
}

function instant(le: string | null | undefined): number {
  if (!le) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(le);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Le plus récent des deux ; à égalité, `a` (la source déjà retenue). */
export function plusRecent(a: ModeleDate, b: ModeleDate): ModeleDate {
  return instant(b.le) > instant(a.le) ? b : a;
}

/** Le plus récent de deux sources dont l'une peut être absente. */
export function plusRecentOpt(a: ModeleDate | null, b: ModeleDate | null): ModeleDate | null {
  if (a === null) return b;
  return b === null ? a : plusRecent(a, b);
}
