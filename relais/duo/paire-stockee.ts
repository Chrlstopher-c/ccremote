// Responsabilité : la paire du mode duo (identifiant, clé longue durée, nom du pair, adresse) dans le dossier de
// secrets du relais — un fichier 600, écriture atomique. Jamais journalisé : seule l'erreur d'E/S l'est.
import type { Logger } from 'pino';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const Paire = z.object({
  id: z.string(),
  cle: z.string(),
  utilisateur: z.string(),
  adresse: z.string().nullable(), // hôte:port du relais du pair ; null = ce relais écoute, l'autre appelle
  creeLe: z.string(),
  // Par l'aiguilleur (étape 7) : identifiant du nœud du pair, son identité publique, l'empreinte à comparer.
  transport: z.enum(['direct', 'aiguilleur']).optional(), // absent = direct (paires d'avant l'étape 7)
  membre: z.string().optional(),
  identite: z.string().optional(),
  empreinte: z.string().optional(),
});
export type Paire = z.infer<typeof Paire>;

export class PaireStockee {
  private readonly chemin: string;

  constructor(
    dossierSecrets: string,
    private readonly journal: Logger,
  ) {
    this.chemin = join(dossierSecrets, 'duo', 'paire.json');
  }

  lire(): Paire | null {
    if (!existsSync(this.chemin)) return null;
    try {
      const r = Paire.safeParse(JSON.parse(readFileSync(this.chemin, 'utf8')));
      return r.success ? r.data : null;
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'paire du mode duo illisible');
      return null;
    }
  }

  ecrire(paire: Paire): void {
    try {
      mkdirSync(dirname(this.chemin), { recursive: true, mode: 0o700 });
      const temporaire = `${this.chemin}.tmp`;
      writeFileSync(temporaire, `${JSON.stringify(paire)}\n`, { mode: 0o600 });
      chmodSync(temporaire, 0o600);
      renameSync(temporaire, this.chemin);
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'paire du mode duo non écrite');
      throw erreur;
    }
  }

  effacer(): void {
    try {
      rmSync(this.chemin, { force: true });
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'paire du mode duo non effacée');
    }
  }
}
