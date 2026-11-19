// Responsabilité : supprimer le transcript d'une session du poste (son fichier JSONL et le dossier de ses sous-agents)
// et retenir les identifiants supprimés, pour qu'aucune découverte ne les fasse réapparaître.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Logger } from 'pino';
import { dossiersProjets } from './decouverte.ts';

const IDENTIFIANT = /^[A-Za-z0-9-]{1,100}$/;

// Les fichiers `<id>.jsonl` de la session dans les configurations connues (aucun si elle n'a pas encore écrit).
export function transcriptsDeLaSession(id: string, configDirs: readonly (string | null)[]): string[] {
  return dossiersProjets(configDirs).flatMap((projets) =>
    readdirSync(projets)
      .map((dossier) => join(projets, dossier, `${id}.jsonl`))
      .filter((chemin) => existsSync(chemin)),
  );
}

// Le transcript d'une session est `<config>/projects/<dossier>/<id>.jsonl`. Tout autre chemin est refusé.
export function supprimerTranscript(chemin: string, sessionId: string, journal: Logger): string[] {
  if (!IDENTIFIANT.test(sessionId)) throw new Error(`identifiant de session invalide : ${sessionId}`);
  const dossier = dirname(chemin);
  if (basename(chemin) !== `${sessionId}.jsonl` || basename(dirname(dossier)) !== 'projects') {
    throw new Error(`chemin de transcript refusé : ${chemin}`);
  }
  const retires: string[] = [];
  if (existsSync(chemin)) {
    rmSync(chemin, { force: true });
    retires.push(chemin);
  }
  const sousDossier = join(dossier, sessionId);
  if (existsSync(sousDossier)) {
    rmSync(sousDossier, { recursive: true, force: true });
    retires.push(sousDossier);
  }
  journal.info({ session: sessionId, retires: retires.length }, 'transcript supprimé');
  return retires;
}

// Identifiants de sessions supprimées par Chris, gardés sur le poste (fichier propre au poste, écriture atomique).
export class SessionsSupprimees {
  private readonly fichier: string;
  private readonly ids: Set<string>;

  constructor(dossier: string) {
    this.fichier = join(dossier, 'supprimees.json');
    this.ids = new Set(this.charger());
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  ajouter(id: string): void {
    this.ids.add(id);
    mkdirSync(dirname(this.fichier), { recursive: true });
    const temporaire = `${this.fichier}.tmp`;
    writeFileSync(temporaire, JSON.stringify([...this.ids]));
    renameSync(temporaire, this.fichier);
  }

  private charger(): string[] {
    if (!existsSync(this.fichier)) return [];
    try {
      const brut: unknown = JSON.parse(readFileSync(this.fichier, 'utf8'));
      return Array.isArray(brut) ? brut.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
}
