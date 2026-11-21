// Responsabilité : les noms affichés du mode duo — le mien (par défaut mon nom d'utilisateur, réglable) et celui que
// mon pair m'a annoncé. Une ligne en base ; un nom vide revient au nom d'utilisateur.
import type { Database } from 'bun:sqlite';

export class IdentiteDuo {
  constructor(
    private readonly base: Database,
    private readonly utilisateur: string,
  ) {
    base.exec(
      'CREATE TABLE IF NOT EXISTS duo_identite (id INTEGER PRIMARY KEY CHECK (id = 1), nom_local TEXT, nom_pair TEXT)',
    );
    base.exec('INSERT OR IGNORE INTO duo_identite (id) VALUES (1)');
  }

  nomLocal(): string {
    return this.lire('nom_local') ?? this.utilisateur;
  }

  ecrireNomLocal(nom: string): void {
    this.base.query('UPDATE duo_identite SET nom_local = $n WHERE id = 1').run({ n: nom === '' ? null : nom });
  }

  nomPair(): string | null {
    return this.lire('nom_pair');
  }

  ecrireNomPair(nom: string | null): void {
    this.base.query('UPDATE duo_identite SET nom_pair = $n WHERE id = 1').run({ n: nom });
  }

  private lire(colonne: 'nom_local' | 'nom_pair'): string | null {
    const ligne = this.base.query(`SELECT ${colonne} AS nom FROM duo_identite WHERE id = 1`).get() as {
      nom: string | null;
    } | null;
    return ligne?.nom ?? null;
  }
}
