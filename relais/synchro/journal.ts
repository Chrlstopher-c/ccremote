// Responsabilité : le journal des synchronisations de ce nœud — qui a demandé quoi, quand, accordé ou
// refusé, combien d'éléments sont partis ou appliqués. Fichier JSON borné, réécrit d'un bloc. Aucun contenu de session.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { Perimetre, type PerimetreSynchro } from '../../commun/synchro.ts';
import type { BilanFusion } from './paquet.ts';

export const NOMBRE_MAX_ENTREES_JOURNAL = 500;

export type SensJournal =
  | 'demandee'
  | 'recue'
  | 'accordee'
  | 'refusee'
  | 'expiree'
  | 'envoyee'
  | 'appliquee'
  | 'rejetee';

export interface EntreeJournal {
  readonly le: string;
  readonly sens: SensJournal;
  readonly pair: string;
  readonly demande: string;
  readonly quoi: readonly PerimetreSynchro[];
  readonly elements?: number;
  readonly bilan?: BilanFusion;
  readonly detail?: string;
}

const BILAN = z.object({ appliques: z.number(), dejaPresents: z.number(), ignores: z.number() });
const ENTREE = z.object({
  le: z.string(),
  sens: z.enum(['demandee', 'recue', 'accordee', 'refusee', 'expiree', 'envoyee', 'appliquee', 'rejetee']),
  pair: z.string(),
  demande: z.string(),
  quoi: z.array(Perimetre),
  elements: z.number().optional(),
  bilan: BILAN.optional(),
  detail: z.string().optional(),
});
const FICHIER = z.array(ENTREE);

export class JournalSynchro {
  private entrees: EntreeJournal[];

  constructor(
    private readonly fichier: string,
    private readonly journal: Logger,
  ) {
    this.entrees = this.lire();
  }

  ajouter(entree: Omit<EntreeJournal, 'le'>): EntreeJournal {
    const complete: EntreeJournal = { ...entree, le: new Date().toISOString() };
    this.entrees = [...this.entrees, complete].slice(-NOMBRE_MAX_ENTREES_JOURNAL);
    this.ecrire();
    const { sens, pair, demande, detail } = entree;
    this.journal.info({ sens, pair, demande, detail }, 'synchro');
    return complete;
  }

  lister(): EntreeJournal[] {
    return [...this.entrees];
  }

  private lire(): EntreeJournal[] {
    if (!existsSync(this.fichier)) return [];
    try {
      const r = FICHIER.safeParse(JSON.parse(readFileSync(this.fichier, 'utf8')));
      if (r.success) return r.data.slice(-NOMBRE_MAX_ENTREES_JOURNAL);
      this.journal.warn('journal synchro illisible, ignoré');
    } catch (erreur) {
      this.journal.warn({ err: erreur }, 'journal synchro illisible, ignoré');
    }
    return [];
  }

  private ecrire(): void {
    const temporaire = `${this.fichier}.tmp`;
    try {
      mkdirSync(dirname(this.fichier), { recursive: true, mode: 0o700 });
      writeFileSync(temporaire, JSON.stringify(this.entrees), { mode: 0o600 });
      renameSync(temporaire, this.fichier);
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'journal synchro : écriture impossible');
    }
  }
}
