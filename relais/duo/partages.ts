// Responsabilité : la table des partages du mode duo (session ou projet, niveau) et ce qu'ils désignent parmi les
// sessions du relais. Un projet se désigne par `machine:chemin`.
import type { Database } from 'bun:sqlite';
import type { NiveauPartage, PartageDuo } from '../../commun/duo.ts';
import type { ResumeSession } from '../../commun/session.ts';

interface LignePartage {
  cible: string;
  genre: PartageDuo['genre'];
  niveau: NiveauPartage;
  cree_le: string;
}

export function cibleProjet(machine: string, chemin: string): string {
  return `${machine}:${chemin}`;
}

// Niveau accordé à une session par les partages : l'écriture l'emporte sur la lecture ; null = non partagée.
export function niveauPour(session: ResumeSession, partages: readonly PartageDuo[]): NiveauPartage | null {
  const projet = cibleProjet(session.projet.machine, session.projet.chemin);
  let niveau: NiveauPartage | null = null;
  for (const p of partages) {
    // Un projet se désigne par `machine:chemin` ou par son chemin seul (le même dossier, quelle que soit la machine).
    const vise =
      p.genre === 'session' ? p.cible === session.id : p.cible === projet || p.cible === session.projet.chemin;
    if (!vise) continue;
    if (p.niveau === 'ecriture') return 'ecriture';
    niveau = 'lecture';
  }
  return niveau;
}

export class PartagesDuo {
  constructor(private readonly db: Database) {}

  lister(): PartageDuo[] {
    const lignes = this.db
      .query('SELECT cible, genre, niveau, cree_le FROM duo_partages ORDER BY cree_le, cible')
      .all() as LignePartage[];
    return lignes.map((l) => ({ cible: l.cible, genre: l.genre, niveau: l.niveau, creeLe: l.cree_le }));
  }

  ajouter(cible: string, genre: PartageDuo['genre'], niveau: NiveauPartage, quand: string): void {
    this.db
      .query(
        `INSERT INTO duo_partages (cible, genre, niveau, cree_le) VALUES ($c, $g, $n, $q)
         ON CONFLICT(cible, genre) DO UPDATE SET niveau = $n`,
      )
      .run({ c: cible, g: genre, n: niveau, q: quand });
  }

  retirer(cible: string): number {
    return this.db.query('DELETE FROM duo_partages WHERE cible = $c').run({ c: cible }).changes;
  }

  vider(): void {
    this.db.query('DELETE FROM duo_partages').run();
  }
}
