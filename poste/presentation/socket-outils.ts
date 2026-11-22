// Responsabilité : le protocole du socket des outils de modules ouvert aux sessions hors de Lanterne — une requête JSON
// par ligne, une réponse JSON par ligne — et le chemin de ce socket. Partagé par l'écoute du poste et le serveur MCP
// externe, pour qu'ils parlent exactement la même langue.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { QuoiRelais, type ReponseRelais } from '../../commun/modules.ts';

// Posée par le poste dans l'environnement des sessions qu'il pilote : le serveur externe s'efface alors chez elles.
export const VAR_SESSION_PILOTEE = 'LANTERNE_SESSION_PILOTEE';
// Chemin du socket, pour forcer l'emplacement (banc d'essai, tests) ; absente : le chemin par défaut.
export const VAR_SOCKET_OUTILS = 'LANTERNE_SOCKET_OUTILS';
export const TAILLE_MAX_LIGNE_OUTILS = 128 * 1024; // octets, une requête (arguments compris) par ligne
export const DELAI_CONNEXION_OUTILS_MS = 2_000;
export const DELAI_REPONSE_OUTILS_MS = 40_000; // le relais répond avant 35 s (poste/parc/requetes-relais.ts)
export const MESSAGE_SERVICE_ABSENT = 'Lanterne n’est pas en service sur cette machine';
export const MESSAGE_SANS_REPONSE = 'Lanterne ne répond pas dans le délai imparti';

export const DemandeOutils = z.object({
  id: z.string().min(1).max(64),
  quoi: QuoiRelais,
  args: z.record(z.string(), z.unknown()).optional(),
});
export type DemandeOutils = z.infer<typeof DemandeOutils>;

/** Chemin fixe par utilisateur : `XDG_RUNTIME_DIR/lanterne`, sinon `/run/user/<uid>`, sinon le dossier `donnees`. */
export function cheminSocketOutils(
  env: Readonly<Record<string, string | undefined>>,
  uid: number | undefined,
  donnees: string,
): string {
  const explicite = env[VAR_SOCKET_OUTILS];
  if (explicite) return explicite;
  const runtime =
    env['XDG_RUNTIME_DIR'] || (uid !== undefined && existsSync(`/run/user/${uid}`) ? `/run/user/${uid}` : '');
  return join(runtime ? join(runtime, 'lanterne') : donnees, 'outils.sock');
}

/** Les arguments relayés au relais : `module_appeler` part toujours sans session (le poste ne l'attribue jamais). */
export function argsRelais(demande: DemandeOutils): unknown {
  if (demande.quoi === 'modules_lister') return {};
  return { ...demande.args, session: null };
}

export type DecodageDemande =
  | { readonly ok: true; readonly demande: DemandeOutils }
  | { readonly ok: false; readonly id: string | null; readonly erreur: string };

/** Lit une ligne : JSON, puis schéma (opération dans la liste blanche). Une erreur rend l'id quand il est lisible. */
export function decoderDemande(ligne: string): DecodageDemande {
  let brut: unknown;
  try {
    brut = JSON.parse(ligne);
  } catch {
    return { ok: false, id: null, erreur: 'requête illisible (JSON attendu)' };
  }
  const id = typeof brut === 'object' && brut !== null && 'id' in brut && typeof brut.id === 'string' ? brut.id : null;
  const lue = DemandeOutils.safeParse(brut);
  if (!lue.success) return { ok: false, id, erreur: 'requête refusée : opération ou forme hors liste' };
  return { ok: true, demande: lue.data };
}

const ReponseLue = z.object({
  id: z.string().nullable(),
  ok: z.boolean(),
  donnees: z.unknown().optional(),
  erreur: z.string().optional(),
});

/** Lit la ligne de réponse du poste ; une ligne illisible devient un refus, jamais une exception. */
export function lireReponse(ligne: string): ReponseRelais {
  let brut: unknown;
  try {
    brut = JSON.parse(ligne);
  } catch {
    return { ok: false, erreur: 'réponse illisible' };
  }
  const lue = ReponseLue.safeParse(brut);
  if (!lue.success) return { ok: false, erreur: 'réponse illisible' };
  return { ok: lue.data.ok, donnees: lue.data.donnees, erreur: lue.data.erreur };
}

/** La ligne de réponse : `{ id, ok, donnees?, erreur? }`, terminée par un saut de ligne. */
export function ligneReponse(id: string | null, r: ReponseRelais): string {
  const corps = {
    id,
    ok: r.ok,
    ...(r.donnees !== undefined ? { donnees: r.donnees } : {}),
    ...(r.erreur ? { erreur: r.erreur } : {}),
  };
  return `${JSON.stringify(corps)}\n`;
}
