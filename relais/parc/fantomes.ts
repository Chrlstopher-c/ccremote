// Responsabilité : les fiches fantômes — fermées, sur un poste en ligne, dont la conversation n'existe sur aucun
// poste en ligne. Un poste hors ligne ne compte pas : ses fiches ne sont jamais touchées, et tant qu'un poste en
// ligne n'a pas annoncé ses transcripts, rien n'est décidé.
export interface FicheFantome {
  readonly id: string;
  readonly machine: string;
  readonly conversation: string | null;
  readonly statut: string;
  readonly archivee: boolean;
}

/** Identifiants des fiches à masquer. `annonces` : transcripts annoncés par machine. */
export function fantomesARetirer(
  fiches: readonly FicheFantome[],
  annonces: ReadonlyMap<string, ReadonlySet<string>>,
  connectees: ReadonlySet<string>,
): string[] {
  if (connectees.size === 0) return [];
  for (const machine of connectees) if (!annonces.has(machine)) return [];
  const existantes = new Set<string>();
  for (const machine of connectees) for (const id of annonces.get(machine) ?? []) existantes.add(id);
  return fiches
    .filter(
      (f) =>
        connectees.has(f.machine) &&
        !f.archivee &&
        f.statut === 'fermee' &&
        f.conversation !== null &&
        !existantes.has(f.conversation),
    )
    .map((f) => f.id);
}
