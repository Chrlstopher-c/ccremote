// Responsabilité : les droits que le propriétaire accorde à son pair (écriture sans permissions, ouverture de session,
// dossiers ouverts, usage, modules) — une seule ligne en base, par défaut les réglages les plus fermés.
import type { Database } from 'bun:sqlite';
import type { Logger } from 'pino';
import { DROITS_PAR_DEFAUT, type DossierOuvert, Droits } from '../../commun/duo.ts';

export class DroitsDuo {
  constructor(
    private readonly base: Database,
    private readonly journal: Logger,
  ) {
    base.exec(`CREATE TABLE IF NOT EXISTS duo_droits (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL)`);
  }

  lire(): Droits {
    try {
      const ligne = this.base.query('SELECT document FROM duo_droits WHERE id = 1').get() as {
        document: string;
      } | null;
      if (!ligne) return DROITS_PAR_DEFAUT;
      const r = Droits.safeParse(JSON.parse(ligne.document));
      return r.success ? r.data : DROITS_PAR_DEFAUT;
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'droits du mode duo illisibles : réglages par défaut');
      return DROITS_PAR_DEFAUT;
    }
  }

  ecrire(droits: Droits): Droits {
    this.base
      .query('INSERT INTO duo_droits (id, document) VALUES (1, $d) ON CONFLICT(id) DO UPDATE SET document = $d')
      .run({ d: JSON.stringify(droits) });
    return droits;
  }
}

/** Vrai si le dossier demandé est un dossier ouvert, ou un sous-dossier de l'un d'eux, sur la même machine. */
export function dossierAutorise(dossiers: readonly DossierOuvert[], machine: string, chemin: string): boolean {
  return dossiers.some((d) => {
    if (d.machine !== machine) return false;
    const racine = d.chemin.endsWith('/') ? d.chemin : `${d.chemin}/`;
    return chemin === d.chemin || chemin.startsWith(racine);
  });
}
