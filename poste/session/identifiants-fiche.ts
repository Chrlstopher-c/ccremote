// Responsabilité : à quelle fiche appartient un identifiant de transcript (courant, ancien avant rembobinage, ou celui de
// la fiche). Sert à l'adoption (une conversation SDK n'est jamais une session à part) et au nettoyage des fantômes. Pur.
export interface FicheIdentifiee {
  readonly resume: { readonly id: string; readonly claudeSessionId: string | null };
  readonly identifiants?: readonly string[];
}

export function fichePourIdentifiant<T extends FicheIdentifiee>(fiches: Iterable<T>, id: string): T | undefined {
  const liste = [...fiches];
  return (
    liste.find((f) => f.resume.id === id) ??
    liste.find((f) => f.resume.claudeSessionId === id || (f.identifiants?.includes(id) ?? false))
  );
}

// Fiche fantôme : son identifiant est le transcript courant ou ancien d'une AUTRE fiche (rembobinage du premier message).
export function fantomes<T extends FicheIdentifiee>(fiches: readonly T[]): T[] {
  return fiches.filter((g) =>
    fiches.some((f) => f !== g && (f.resume.claudeSessionId === g.resume.id || (f.identifiants?.includes(g.resume.id) ?? false))),
  );
}
