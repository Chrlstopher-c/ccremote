// Responsabilité : les fichiers présentés par une session, stockés sur le poste — un dossier par session, un fichier par
// présentation et son `.json` de métadonnées. Écriture atomique ; lecture par identifiant seulement (jamais de chemin).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { estIdFichier } from '../../commun/presentation.ts';

// Sessions claude.ai (Remote Control) : identifiants « cse_… », d'où le souligné.
const IDENTIFIANT_SESSION = /^[A-Za-z0-9_-]{1,100}$/;

export interface MetaFichier {
  readonly nom: string;
  readonly mime: string;
  readonly taille: number;
}

export interface FichierStocke {
  readonly meta: MetaFichier;
  readonly octets: Buffer;
}

export function ecrireAtomique(chemin: string, contenu: Uint8Array | string): void {
  const temporaire = `${chemin}.tmp`;
  writeFileSync(temporaire, contenu);
  renameSync(temporaire, chemin);
}

export class Stockage {
  constructor(private readonly racine: string) {}

  dossier(sessionId: string): string {
    if (!IDENTIFIANT_SESSION.test(sessionId)) throw new Error(`identifiant de session invalide : ${sessionId}`);
    return join(this.racine, 'fichiers', sessionId);
  }

  nouvelId(): string {
    return randomBytes(8).toString('hex');
  }

  ecrire(sessionId: string, id: string, octets: Uint8Array, meta: MetaFichier): void {
    if (!estIdFichier(id)) throw new Error(`identifiant de fichier invalide : ${id}`);
    const dossier = this.dossier(sessionId);
    mkdirSync(dossier, { recursive: true });
    ecrireAtomique(join(dossier, id), octets);
    ecrireAtomique(join(dossier, `${id}.json`), JSON.stringify(meta));
  }

  /** Le fichier est déjà stocké : même identifiant, même contenu (identifiant tiré de l'empreinte). */
  existe(sessionId: string, id: string): boolean {
    return estIdFichier(id) && existsSync(join(this.dossier(sessionId), `${id}.json`));
  }

  /** Le fichier et ses métadonnées, ou null si l'identifiant est inconnu. Une lecture illisible lève. */
  lire(sessionId: string, id: string): FichierStocke | null {
    if (!estIdFichier(id)) return null;
    const dossier = this.dossier(sessionId);
    const meta = join(dossier, `${id}.json`);
    if (!existsSync(meta)) return null;
    const brut = JSON.parse(readFileSync(meta, 'utf8')) as MetaFichier;
    return { meta: brut, octets: readFileSync(join(dossier, id)) };
  }

  /** Nombre de versions déjà publiées pour un artefact. */
  versions(sessionId: string, artefact: string): number {
    const dossier = this.dossier(sessionId);
    if (!existsSync(dossier)) return 0;
    return readdirSync(dossier).filter((f) => f.startsWith(`${artefact}-v`) && !/\.(json|tmp)$/.test(f)).length;
  }

  supprimer(sessionId: string): void {
    rmSync(this.dossier(sessionId), { recursive: true, force: true });
  }
}
