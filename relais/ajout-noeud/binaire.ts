// Responsabilité : trouver ce qu'on installe sur la nouvelle machine — le binaire du moteur qui tourne ici (même
// version que ce nœud) et l'archive du code des postes — et les préparer à l'envoi (binaire compressé).
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

export interface SourcesNoeud {
  /** Le binaire compressé (gzip), prêt pour `gzip -dc` sur la machine. */
  readonly binaireGz: Uint8Array;
  readonly codePoste: Uint8Array;
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Le binaire du moteur : `LANTERNE_MOTEUR_BINAIRE` (fichier nu ou `.gz`), sinon l'exécutable de ce processus s'il est
 * le moteur compilé (pas `bun`). Null : ce relais ne tourne pas comme moteur Lanterne.
 */
export function cheminBinaire(env: Env = process.env, executable: string = process.execPath): string | null {
  const choisi = env['LANTERNE_MOTEUR_BINAIRE'];
  if (choisi) return existsSync(choisi) ? choisi : null;
  return basename(executable).startsWith('bun') ? null : executable;
}

/** Lit et prépare les deux fichiers ; une erreur lisible si l'un manque. */
export function lireSources(binaire: string | null, codePoste: string | null): SourcesNoeud {
  if (!binaire) throw new Error('binaire du moteur introuvable (LANTERNE_MOTEUR_BINAIRE)');
  if (!codePoste || !existsSync(codePoste)) throw new Error('archive du code des postes introuvable');
  const brut = new Uint8Array(readFileSync(binaire));
  const binaireGz = binaire.endsWith('.gz') ? brut : Bun.gzipSync(brut, { level: 6 });
  return { binaireGz, codePoste: new Uint8Array(readFileSync(codePoste)) };
}
