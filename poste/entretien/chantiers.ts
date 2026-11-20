// Responsabilité : lire, en LECTURE SEULE, les fichiers de suivi des agents d'une machine (dossier des chantiers), les
// normaliser et les rendre triés (en cours d'abord, puis le plus récent). N'écrit jamais rien.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { ChantierPoste } from '../../commun/entretien.ts';
import { normaliserChantier } from './chantiers-normaliser.ts';

export const MAX_FICHIERS = 200;
export const MAX_OCTETS = 64 * 1024;

const RANG: Record<ChantierPoste['statut'], number> = { en_cours: 0, echec: 1, inconnu: 2, termine: 3 };

/** Le dossier des suivis : `LANTERNE_DOSSIER_CHANTIERS`, sinon le dossier d'état `chantier` de l'utilisateur. */
export function dossierChantiers(env: NodeJS.ProcessEnv = process.env): string {
  return env['LANTERNE_DOSSIER_CHANTIERS'] || join(homedir(), '.local', 'state', 'chantier');
}

interface FichierDate {
  readonly nom: string;
  readonly chemin: string;
  readonly mtimeMs: number;
}

// Les fichiers `.json` seulement, du plus récent au plus ancien ; un fichier introuvable en cours de route est sauté.
function fichiersRecents(dossier: string, journal: Logger): FichierDate[] {
  let noms: string[];
  try {
    noms = readdirSync(dossier).filter((n) => n.endsWith('.json'));
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT')
      journal.warn({ err: erreur }, 'dossier des chantiers illisible');
    return [];
  }
  const fichiers: FichierDate[] = [];
  for (const nom of noms) {
    const chemin = join(dossier, nom);
    try {
      fichiers.push({ nom, chemin, mtimeMs: statSync(chemin).mtimeMs });
    } catch (erreur) {
      journal.debug({ err: erreur }, 'suivi disparu pendant la lecture');
    }
  }
  return fichiers.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_FICHIERS);
}

// Un fichier trop gros, illisible ou pas du JSON est ignoré : il ne doit pas bloquer les autres.
function lireUn(f: FichierDate, journal: Logger): ChantierPoste | null {
  try {
    if (statSync(f.chemin).size > MAX_OCTETS) return null;
    const brut: unknown = JSON.parse(readFileSync(f.chemin, 'utf8'));
    return normaliserChantier(f.nom, brut, new Date(f.mtimeMs).toISOString());
  } catch (erreur) {
    journal.debug({ fichier: f.nom, err: erreur }, 'suivi illisible, ignoré');
    return null;
  }
}

/** Les chantiers du dossier, triés : en cours, en échec, inconnus, terminés ; à statut égal, le plus récent d'abord. */
export function lireChantiers(dossier: string, journal: Logger): ChantierPoste[] {
  const chantiers: ChantierPoste[] = [];
  for (const f of fichiersRecents(dossier, journal)) {
    const c = lireUn(f, journal);
    if (c) chantiers.push(c);
  }
  return chantiers.sort((a, b) => RANG[a.statut] - RANG[b.statut] || b.majLe.localeCompare(a.majLe));
}
