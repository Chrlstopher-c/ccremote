// Responsabilité : le CLAUDE.md personnel de la machine (`~/.claude/CLAUDE.md`) — lecture, et écriture atomique qui
// refuse d'écraser une modification faite entre-temps (empreinte sha256 du contenu lu).
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Logger } from 'pino';
import type { InstructionsMachine } from '../../commun/configuration.ts';

export type ResultatEcriture =
  { readonly ok: true; readonly empreinte: string } | { readonly ok: false; readonly erreur: string };

export function empreinte(contenu: string): string {
  return createHash('sha256').update(contenu).digest('hex');
}

export function lireInstructions(dossierConfig: string, journal: Logger): InstructionsMachine {
  const chemin = join(dossierConfig, 'CLAUDE.md');
  const contenu = lireBrut(chemin, journal) ?? '';
  return { chemin, contenu, empreinte: empreinte(contenu) };
}

export function ecrireInstructions(
  dossierConfig: string,
  contenu: string,
  empreinteAvant: string,
  journal: Logger,
): ResultatEcriture {
  const actuel = lireInstructions(dossierConfig, journal);
  if (existsSync(actuel.chemin) && lireBrut(actuel.chemin, journal) === null)
    return { ok: false, erreur: 'lecture impossible' };
  if (actuel.empreinte !== empreinteAvant) return { ok: false, erreur: 'conflit' };
  return ecritureAtomique(actuel.chemin, contenu, journal);
}

function ecritureAtomique(chemin: string, contenu: string, journal: Logger): ResultatEcriture {
  const temporaire = `${chemin}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(chemin), { recursive: true });
    writeFileSync(temporaire, contenu);
    renameSync(temporaire, chemin);
    return { ok: true, empreinte: empreinte(contenu) };
  } catch (erreur) {
    journal.error({ err: erreur, chemin }, 'écriture des instructions impossible');
    supprimerSiPresent(temporaire);
    return { ok: false, erreur: 'écriture impossible' };
  }
}

// Contenu d'un fichier absent (chaîne vide) ou illisible (null) : un fichier illisible n'est jamais réécrit.
function lireBrut(chemin: string, journal: Logger): string | null {
  if (!existsSync(chemin)) return '';
  try {
    return readFileSync(chemin, 'utf8');
  } catch (erreur) {
    journal.error({ err: erreur, chemin }, 'lecture des instructions impossible');
    return null;
  }
}

function supprimerSiPresent(chemin: string): void {
  try {
    if (existsSync(chemin)) unlinkSync(chemin);
  } catch {
    // Le temporaire orphelin n'est pas une erreur de Chris : la trace est dans le journal de l'écriture.
  }
}
