// Responsabilité : les mises à jour de l'appli distribuées par l'aiguilleur aux seuls membres du réseau. Le chef y
// dépose le manifeste (`latest.json`) et les paquets signés ; un membre (jeton du lien) les lit par GET /maj/<fichier>.
// La signature des paquets est vérifiée par l'appli : l'aiguilleur ne fait que servir des fichiers d'un dossier.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';

export const PREFIXE_MISES_A_JOUR = '/maj/';

/** Noms servis : le manifeste, et des paquets aux extensions connues (jamais de chemin ni de fichier caché). */
const NOM_PERMIS = /^(latest\.json|[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(AppImage|exe|msi|sig|tar\.gz|zip))$/;

export interface PortMisesAJour {
  readonly dossier: string | null; // LANTERNE_MAJ_DOSSIER ; null : pas de distribution (404)
  readonly membreDuJeton: (jeton: string) => { readonly revoque: boolean } | null;
  readonly journal: Logger;
}

/** Le nom de fichier demandé s'il est servable, sinon null. */
export function nomServable(chemin: string): string | null {
  if (!chemin.startsWith(PREFIXE_MISES_A_JOUR)) return null;
  const nom = decodeURIComponent(chemin.slice(PREFIXE_MISES_A_JOUR.length));
  return NOM_PERMIS.test(nom) ? nom : null;
}

export function routeMisesAJour(p: PortMisesAJour): (req: Request) => Response {
  return (req) => {
    const nom = nomServable(new URL(req.url).pathname);
    if (p.dossier === null || nom === null) return new Response('introuvable', { status: 404 });
    const entete = req.headers.get('authorization') ?? '';
    const jeton = entete.startsWith('Bearer ') ? entete.slice(7) : '';
    const membre = jeton === '' ? null : p.membreDuJeton(jeton);
    if (membre === null || membre.revoque) return new Response('non connecté', { status: 401 });
    const fichier = join(p.dossier, nom);
    try {
      if (!existsSync(fichier) || !statSync(fichier).isFile()) return new Response('introuvable', { status: 404 });
      return new Response(Bun.file(fichier));
    } catch (erreur) {
      p.journal.warn({ err: erreur, nom }, 'mise à jour : fichier illisible');
      return new Response('erreur', { status: 500 });
    }
  };
}
