// Responsabilité : le registre des sessions lancées par `cc` (poste/session/cc) — une fiche JSON par session, lue par
// Quart pour le nom, l'id et le lanceur. Seule lecture ici ; l'écriture appartient au script `cc`.
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { LanceurSession } from '../../commun/session.ts';

const EntreeCc = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]+$/),
  nom: z.string(),
  cwd: z.string(),
  tmux: z.string().nullable(),
  lanceur: LanceurSession,
  creeLe: z.string(),
});
export type EntreeCc = z.infer<typeof EntreeCc>;

export function dossierRegistreCc(env: Record<string, string | undefined> = process.env): string {
  return join(env['XDG_STATE_HOME'] || join(homedir(), '.local', 'state'), 'cc', 'sessions');
}

function lireFiche(dossier: string, fichier: string, journal: Logger): EntreeCc[] {
  try {
    const r = EntreeCc.safeParse(JSON.parse(readFileSync(join(dossier, fichier), 'utf8')));
    if (r.success) return [r.data];
    journal.debug({ fichier }, 'fiche cc invalide ignorée');
    return [];
  } catch (erreur) {
    journal.debug({ err: erreur, fichier }, 'fiche cc illisible ignorée');
    return [];
  }
}

/** Les fiches du registre, la plus récente d'abord. Dossier absent = aucune session lancée par cc. */
export function lireRegistreCc(dossier: string, journal: Logger): EntreeCc[] {
  let fichiers: string[];
  try {
    fichiers = readdirSync(dossier).filter((f) => f.endsWith('.json'));
  } catch (erreur) {
    journal.debug({ err: erreur, dossier }, 'registre cc absent');
    return [];
  }
  return fichiers
    .flatMap((f) => lireFiche(dossier, f, journal))
    .sort((a, b) => b.creeLe.localeCompare(a.creeLe));
}
