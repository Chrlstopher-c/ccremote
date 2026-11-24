// Responsabilité : le drapeau de pause du nœud — plus de nouvelles sessions ici, les sessions en cours continuent.
// Persistant : `federation/pause.json` (0600) dans le dossier de secrets, relu au démarrage. Chaque changement réel
// est journalisé avec son origine (qui l'a demandé : `local`, `membre:<id>`, `appareil:<id>`, `inconnue`).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { erreur as reponseErreur } from '../clients/http.ts';

export const MOTIF_PAUSE = 'machine en pause : plus de nouvelles sessions';
const FICHIER = 'pause.json';
const CONTENU = z.object({ pause: z.boolean(), le: z.string().optional(), origine: z.string().optional() });

export class PauseNoeud {
  private pause: boolean;

  constructor(
    private readonly dossier: string,
    private readonly journal: Logger,
  ) {
    this.pause = this.lire();
    if (this.pause) this.journal.warn('nœud en pause au démarrage : aucune nouvelle session');
  }

  enPause(): boolean {
    return this.pause;
  }

  /** Pose ou lève la pause ; faux si le drapeau n'a pas pu être écrit, et l'état reste alors inchangé. */
  mettreEnPause(valeur: boolean, origine: string = 'inconnue'): boolean {
    if (valeur === this.pause) return true;
    const le = new Date().toISOString();
    try {
      this.ecrire({ pause: valeur, le, origine });
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'drapeau de pause non écrit');
      return false;
    }
    this.pause = valeur;
    this.journal.info({ pause: valeur, origine }, valeur ? 'nœud mis en pause' : 'nœud repris');
    return true;
  }

  private lire(): boolean {
    try {
      const r = CONTENU.safeParse(JSON.parse(readFileSync(join(this.dossier, FICHIER), 'utf8')));
      return r.success ? r.data.pause : false;
    } catch (erreur) {
      if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.journal.error({ err: erreur }, 'drapeau de pause illisible : nœud tenu pour actif');
      }
      return false;
    }
  }

  private ecrire(contenu: z.infer<typeof CONTENU>): void {
    const chemin = join(this.dossier, FICHIER);
    mkdirSync(this.dossier, { recursive: true, mode: 0o700 });
    const temporaire = `${chemin}.tmp`;
    writeFileSync(temporaire, `${JSON.stringify(contenu)}\n`, { mode: 0o600 });
    renameSync(temporaire, chemin);
  }
}

/** La réponse qui refuse une création de session sur ce nœud en pause ; null si la création est permise. */
export function refusCreationSession(noeud: { enPause(): boolean }): Response | null {
  return noeud.enPause() ? reponseErreur(MOTIF_PAUSE, 409) : null;
}
