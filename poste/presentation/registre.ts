// Responsabilité : le registre des artefacts d'une session (`artefacts.json` dans son dossier) — titre, épinglé, source
// et versions de chaque artefact. Les artefacts publiés avant ce registre (fichiers `<id>-vN` sans entrée) sont
// reconstitués à la lecture : titre dans la métadonnée de la dernière version, date au plus tard par le fichier.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ecrireAtomique, type MetaFichier, type Stockage } from './stockage.ts';

const FICHIER_REGISTRE = 'artefacts.json';
const FICHIER_VERSION = /^([a-f0-9]{16})-v([0-9]{1,4})$/;

export const VersionArtefact = z.object({
  version: z.number().int().positive(),
  fichier: z.string().min(1),
  publieLe: z.string().min(1),
});
export type VersionArtefact = z.infer<typeof VersionArtefact>;

export const EntreeArtefact = z.object({
  titre: z.string().min(1),
  epingle: z.boolean(),
  source: z.string().nullable(),
  versions: z.array(VersionArtefact).min(1),
});
export type EntreeArtefact = z.infer<typeof EntreeArtefact>;

export const RegistreSession = z.record(z.string(), EntreeArtefact);
export type RegistreSession = z.infer<typeof RegistreSession>;

function lireBrut(dossier: string): RegistreSession {
  const chemin = join(dossier, FICHIER_REGISTRE);
  if (!existsSync(chemin)) return {};
  return RegistreSession.parse(JSON.parse(readFileSync(chemin, 'utf8')));
}

function metaDe(dossier: string, fichier: string): MetaFichier | null {
  const chemin = join(dossier, `${fichier}.json`);
  if (!existsSync(chemin)) return null;
  return JSON.parse(readFileSync(chemin, 'utf8')) as MetaFichier;
}

/** Titre d'un artefact ancien : son nom de fichier, sans l'extension HTML. */
function titreDe(meta: MetaFichier | null, identifiant: string): string {
  const nom = meta?.nom.replace(/\.html?$/i, '').trim() ?? '';
  return nom || `Artefact ${identifiant.slice(0, 6)}`;
}

interface VersionTrouvee {
  readonly numero: number;
  readonly fichier: string;
}

/** Entrée reconstituée pour un artefact publié avant le registre : versions dans l'ordre, date par fichier. */
function entreeAncienne(dossier: string, identifiant: string, trouvees: readonly VersionTrouvee[]): EntreeArtefact {
  const ordre = [...trouvees].sort((a, b) => a.numero - b.numero);
  const versions = ordre.map((version) => ({
    version: version.numero,
    fichier: version.fichier,
    publieLe: statSync(join(dossier, version.fichier)).mtime.toISOString(),
  }));
  const derniere = ordre[ordre.length - 1]?.fichier ?? '';
  return { titre: titreDe(metaDe(dossier, derniere), identifiant), epingle: false, source: null, versions };
}

/** Ajoute au registre les artefacts présents sur disque sans entrée. Le registre donné n'est pas modifié. */
export function completerRegistre(stockage: Stockage, sessionId: string, registre: RegistreSession): RegistreSession {
  const dossier = stockage.dossier(sessionId);
  if (!existsSync(dossier)) return registre;
  const parIdentifiant = new Map<string, VersionTrouvee[]>();
  for (const nom of readdirSync(dossier)) {
    const trouve = FICHIER_VERSION.exec(nom);
    if (!trouve) continue;
    const [, identifiant = '', numero = '0'] = trouve;
    if (identifiant in registre) continue;
    parIdentifiant.set(identifiant, [
      ...(parIdentifiant.get(identifiant) ?? []),
      { numero: Number(numero), fichier: nom },
    ]);
  }
  const complete: RegistreSession = { ...registre };
  for (const [identifiant, trouvees] of parIdentifiant) {
    complete[identifiant] = entreeAncienne(dossier, identifiant, trouvees);
  }
  return complete;
}

/** Registre d'une session, complété des artefacts anciens. Un registre illisible lève. */
export function lireRegistre(stockage: Stockage, sessionId: string): RegistreSession {
  return completerRegistre(stockage, sessionId, lireBrut(stockage.dossier(sessionId)));
}

export function ecrireRegistre(stockage: Stockage, sessionId: string, registre: RegistreSession): void {
  const dossier = stockage.dossier(sessionId);
  mkdirSync(dossier, { recursive: true });
  ecrireAtomique(join(dossier, FICHIER_REGISTRE), JSON.stringify(registre, null, 2));
}
