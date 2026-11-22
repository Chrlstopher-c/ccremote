// Responsabilité : l'index des amis ajoutés du mode duo (`<secrets>/duo/amis.json`, fichier 600, écriture atomique) et
// le dossier de chaque ami (`<secrets>/duo/amis/<id>/`, 700) où vivent sa paire et sa base. Stockage seulement : aucune
// logique de duo, et chaque E/S est journalisée ici.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { IDENTIFIANT_AMI_AJOUTE, IdAmi } from '../../commun/duo-amis.ts';

export const EntreeIndex = z.object({ id: IdAmi, creeLe: z.string(), suspendu: z.boolean() });
export type EntreeIndex = z.infer<typeof EntreeIndex>;
const Index = z.array(EntreeIndex);

export class IndexAmis {
  private readonly fichier: string;
  private readonly racine: string;

  constructor(
    dossierSecrets: string,
    private readonly journal: Logger,
  ) {
    this.fichier = join(dossierSecrets, 'duo', 'amis.json');
    this.racine = join(dossierSecrets, 'duo', 'amis');
  }

  lire(): EntreeIndex[] {
    if (!existsSync(this.fichier)) return [];
    try {
      const r = Index.safeParse(JSON.parse(readFileSync(this.fichier, 'utf8')));
      if (!r.success) this.journal.error({ fichier: this.fichier }, 'index des amis du mode duo invalide');
      return r.success ? r.data : [];
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'index des amis du mode duo illisible');
      return [];
    }
  }

  ecrire(entrees: readonly EntreeIndex[]): boolean {
    try {
      mkdirSync(dirname(this.fichier), { recursive: true, mode: 0o700 });
      const temporaire = `${this.fichier}.tmp`;
      writeFileSync(temporaire, `${JSON.stringify(entrees)}\n`, { mode: 0o600 });
      chmodSync(temporaire, 0o600);
      renameSync(temporaire, this.fichier);
      return true;
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'index des amis du mode duo non écrit');
      return false;
    }
  }

  /** Crée le dossier d'un ami ajouté ; rend son chemin, ou null si l'E/S échoue. */
  creerDossier(id: string): string | null {
    try {
      const dossier = this.dossierDe(id);
      mkdirSync(dossier, { recursive: true, mode: 0o700 });
      return dossier;
    } catch (erreur) {
      this.journal.error({ err: erreur, ami: id }, 'dossier d’ami du mode duo non créé');
      return null;
    }
  }

  effacerDossier(id: string): boolean {
    try {
      rmSync(this.dossierDe(id), { recursive: true, force: true });
      return true;
    } catch (erreur) {
      this.journal.error({ err: erreur, ami: id }, 'dossier d’ami du mode duo non effacé');
      return false;
    }
  }

  // Seul un identifiant d'ami ajouté (12 hexadécimaux) donne un chemin : ni `..` ni `principal` ne sortent.
  private dossierDe(id: string): string {
    if (!IDENTIFIANT_AMI_AJOUTE.test(id)) throw new Error('identifiant d’ami invalide');
    return join(this.racine, id);
  }
}
