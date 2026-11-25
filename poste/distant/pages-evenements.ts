// Responsabilité : lire les pages d'un fil claude.ai jusqu'à une borne. La borne compte les événements affichables
// (les `system` n'entament pas l'historique) ; un plafond de pages empêche une lecture sans fin.
import type { EvenementBrut, PageEvenements } from './donnees.ts';
import type { ResultatApi } from './client-claude-ai.ts';
import { estAffichable } from './traduction-distante.ts';

export interface BornesLecture {
  readonly pages: number; // plafond de pages lues
  readonly affichables: number; // arrêt dès que ce nombre d'événements affichables est lu (Infinity : sans borne)
  readonly dejaConnu: (id: string) => boolean; // un événement déjà vu arrête la lecture
}

/** Les événements lus (ordre du fil, du plus récent au plus ancien) jusqu'à une borne ; une erreur de page est rendue. */
export async function lireFil(
  lirePage: (curseur: string | null) => Promise<ResultatApi<PageEvenements>>,
  bornes: BornesLecture,
): Promise<ResultatApi<EvenementBrut[]>> {
  const lus: EvenementBrut[] = [];
  let curseur: string | null = null;
  let affichables = 0;
  for (let i = 0; i < bornes.pages; i++) {
    const page = await lirePage(curseur);
    if (!page.ok) return { ok: false, statut: page.statut, probleme: page.probleme };
    for (const e of page.donnees.evenements) {
      if (bornes.dejaConnu(e.id)) return { ok: true, donnees: lus };
      lus.push(e);
      if (estAffichable(e)) affichables += 1;
      if (affichables >= bornes.affichables) return { ok: true, donnees: lus };
    }
    if (page.donnees.suivant === null || page.donnees.evenements.length === 0) break;
    curseur = page.donnees.suivant;
  }
  return { ok: true, donnees: lus };
}
