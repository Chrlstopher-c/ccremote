// Responsabilité : les secrets du nœud dans la fédération — identité privée, configuration de l'aiguilleur (jeton du
// membre) et pairs acceptés. Tout vit dans le dossier de secrets du relais (fichiers 600, écriture atomique) ; rien ici
// n'est journalisé, seule une erreur d'E/S l'est.
import type { Logger } from 'pino';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { GENRES_MEMBRE } from '../../commun/aiguilleur.ts';
import { IdentitePubliqueTexte } from '../../commun/federation.ts';

const IDENTIFIANT = /^[a-f0-9]{12}$/;

export const ConfigAiguilleur = z.object({
  url: z.string().url(),
  jeton: z.string().min(16),
  id: z.string().regex(IDENTIFIANT),
  nom: z.string().min(1).max(80),
  /** Propriétaire du nœud : donné à l'appairage, ou appris de la présence (absent sur un aiguilleur ancien). */
  proprietaire: z.string().min(1).max(40).optional(),
});
export type ConfigAiguilleur = z.infer<typeof ConfigAiguilleur>;

export const PairFederee = z.object({
  id: z.string().regex(IDENTIFIANT),
  nom: z.string().min(1).max(80),
  identite: IdentitePubliqueTexte,
  creeLe: z.string(),
  /** Un nœud (fédération) ou un appareil client (canal d'API, sans fédération). */
  genre: z.enum(GENRES_MEMBRE).default('noeud'),
});
export type PairFederee = z.infer<typeof PairFederee>;

const PAIRS = z.array(PairFederee);

export class SecretsNoeud {
  private readonly dossier: string;

  constructor(
    dossierSecrets: string,
    private readonly journal: Logger,
  ) {
    this.dossier = join(dossierSecrets, 'federation');
  }

  lireIdentitePrivee(): string | null {
    return this.lireTexte('identite.json');
  }

  ecrireIdentitePrivee(texte: string): void {
    this.ecrireTexte('identite.json', texte);
  }

  lireAiguilleur(): ConfigAiguilleur | null {
    return this.lireJson('aiguilleur.json', ConfigAiguilleur);
  }

  ecrireAiguilleur(config: ConfigAiguilleur): void {
    this.ecrireJson('aiguilleur.json', config);
  }

  effacerAiguilleur(): void {
    this.effacer('aiguilleur.json');
  }

  lirePairs(): PairFederee[] {
    return this.lireJson('pairs.json', PAIRS) ?? [];
  }

  ecrirePairs(pairs: readonly PairFederee[]): void {
    this.ecrireJson('pairs.json', pairs);
  }

  private lireJson<T>(nom: string, schema: z.ZodType<T>): T | null {
    const texte = this.lireTexte(nom);
    if (texte === null) return null;
    try {
      const r = schema.safeParse(JSON.parse(texte));
      if (r.success) return r.data;
      this.journal.error({ fichier: nom }, 'secret de la fédération non conforme : ignoré');
      return null;
    } catch (erreur) {
      this.journal.error({ err: erreur, fichier: nom }, 'secret de la fédération illisible');
      return null;
    }
  }

  private ecrireJson(nom: string, valeur: unknown): void {
    this.ecrireTexte(nom, `${JSON.stringify(valeur)}\n`);
  }

  private lireTexte(nom: string): string | null {
    const chemin = join(this.dossier, nom);
    if (!existsSync(chemin)) return null;
    try {
      return readFileSync(chemin, 'utf8');
    } catch (erreur) {
      this.journal.error({ err: erreur, fichier: nom }, 'secret de la fédération non lu');
      return null;
    }
  }

  private ecrireTexte(nom: string, texte: string): void {
    const chemin = join(this.dossier, nom);
    try {
      mkdirSync(dirname(chemin), { recursive: true, mode: 0o700 });
      const temporaire = `${chemin}.tmp`;
      writeFileSync(temporaire, texte, { mode: 0o600 });
      chmodSync(temporaire, 0o600);
      renameSync(temporaire, chemin);
    } catch (erreur) {
      this.journal.error({ err: erreur, fichier: nom }, 'secret de la fédération non écrit');
      throw erreur;
    }
  }

  private effacer(nom: string): void {
    try {
      rmSync(join(this.dossier, nom), { force: true });
    } catch (erreur) {
      this.journal.error({ err: erreur, fichier: nom }, 'secret de la fédération non effacé');
    }
  }
}
