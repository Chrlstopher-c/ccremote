// Responsabilité : garder sur disque ce que tmux ne sait pas — objectif, autonomie, consignes, position de lecture.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ResumeSession } from '../../commun/session.ts';

export const SessionPersistee = z.object({
  resume: ResumeSession,
  consignes: z.string().nullable(), // null : session adoptée (lancée hors ccremote)
  configDir: z.string().nullable(),
  transcript: z.string().nullable(),
  position: z.number(),
});
export type SessionPersistee = z.infer<typeof SessionPersistee>;

export class PersistanceSessions {
  private readonly fichier: string;

  constructor(dossier: string) {
    this.fichier = join(dossier, 'sessions.json');
  }

  charger(): SessionPersistee[] {
    let brut: unknown;
    try {
      brut = JSON.parse(readFileSync(this.fichier, 'utf8'));
    } catch {
      return []; // premier démarrage : aucune session connue
    }
    const r = z.array(SessionPersistee).safeParse(brut);
    return r.success ? r.data : [];
  }

  ecrire(sessions: readonly SessionPersistee[]): void {
    mkdirSync(dirname(this.fichier), { recursive: true });
    const temporaire = `${this.fichier}.tmp`;
    writeFileSync(temporaire, JSON.stringify(sessions));
    renameSync(temporaire, this.fichier);
  }
}
