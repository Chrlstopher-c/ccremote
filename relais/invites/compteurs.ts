// Responsabilité : les compteurs des invités sur ce nœud (consommation des limites, activité par jour) — un fichier
// 600 écrit atomiquement. Jamais de contenu de session ni de jeton : des nombres et des dates.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';

const FenetreCompteur = z.object({ cle: z.string().nullable(), consomme: z.number().min(0) });
const JourCompteur = z.object({
  sessions: z.number().int().min(0),
  jetons: z.number().min(0),
  derniere: z.string().nullable(),
});
const MembreCompteur = z.object({
  session: FenetreCompteur,
  semaine: FenetreCompteur,
  jours: z.record(z.string(), JourCompteur),
});
const FichierCompteurs = z.object({ membres: z.record(z.string(), MembreCompteur) });
export type FenetreCompteur = z.infer<typeof FenetreCompteur>;
export type JourCompteur = z.infer<typeof JourCompteur>;
export type MembreCompteur = z.infer<typeof MembreCompteur>;

export function membreVide(): MembreCompteur {
  return { session: { cle: null, consomme: 0 }, semaine: { cle: null, consomme: 0 }, jours: {} };
}

/** Compteurs d'un nœud : relus au démarrage (absents ou illisibles : vides), réécrits à chaque changement. */
export class CompteursInvites {
  private etat: Record<string, MembreCompteur>;

  constructor(
    private readonly chemin: string,
    private readonly journal: Logger,
  ) {
    this.etat = this.lire();
  }

  membre(id: string): MembreCompteur {
    return this.etat[id] ?? membreVide();
  }

  /** Remplace le compteur d'un membre par `fn(actuel)`, puis écrit le fichier. */
  miseAJour(id: string, fn: (actuel: MembreCompteur) => MembreCompteur): void {
    this.etat = { ...this.etat, [id]: fn(this.membre(id)) };
    this.ecrire();
  }

  private lire(): Record<string, MembreCompteur> {
    try {
      const lu = FichierCompteurs.safeParse(JSON.parse(readFileSync(this.chemin, 'utf8')));
      if (lu.success) return lu.data.membres;
      this.journal.warn({ chemin: this.chemin }, 'compteurs invités illisibles : repartis de zéro');
    } catch (erreur) {
      if (!isAbsent(erreur)) this.journal.warn({ err: erreur }, 'compteurs invités non relus : repartis de zéro');
    }
    return {};
  }

  private ecrire(): void {
    try {
      mkdirSync(dirname(this.chemin), { recursive: true, mode: 0o700 });
      const tmp = `${this.chemin}.tmp`;
      writeFileSync(tmp, JSON.stringify({ membres: this.etat }), { mode: 0o600 });
      renameSync(tmp, this.chemin);
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'compteurs invités non écrits');
    }
  }
}

function isAbsent(erreur: unknown): boolean {
  return erreur instanceof Error && 'code' in erreur && erreur.code === 'ENOENT';
}
