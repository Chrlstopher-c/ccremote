// Responsabilité : le dossier de données du moteur intégré — création, journal remis à zéro, identifiant de la machine.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { cheminsMoteur } from './environnement.ts';

const DESCRIPTION_PAR_DEFAUT = 'Cet ordinateur';

const FichierConfig = z.object({
  machine: z.string().regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().optional(),
});

export interface Donnees {
  readonly racine: string;
  readonly journal: string;
  readonly machine: string;
  readonly description: string;
}

/** Nom d'hôte rendu compatible avec un identifiant de machine : minuscules, hors `[a-z0-9-]` remplacé par `-`. */
export function nomMachineDepuisHote(hote: string): string {
  const nom = hote
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
  return nom || 'ordinateur';
}

export function preparerDonnees(racine: string, hote: string = hostname()): Donnees {
  const chemins = cheminsMoteur(racine);
  for (const dossier of [racine, chemins.poste, chemins.secrets, join(racine, 'journal')]) {
    mkdirSync(dossier, { recursive: true, mode: 0o700 });
  }
  const journal = join(racine, 'journal/moteur.log');
  garderJournalPrecedent(journal);
  writeFileSync(journal, ''); // remis à zéro à chaque lancement
  const { machine, description } = lireOuCreerConfig(join(racine, 'config.json'), hote);
  return { racine, journal, machine, description };
}

// Le journal du lancement d'avant est gardé (`moteur.precedent.log`) : après un plantage suivi d'une relance
// automatique, la cause n'était plus nulle part (26/11, nœud de la tour sorti en code 1 sans trace).
function garderJournalPrecedent(journal: string): void {
  try {
    if (existsSync(journal)) renameSync(journal, journal.replace(/\.log$/, '.precedent.log'));
  } catch (erreur) {
    console.error('journal précédent non gardé', erreur);
  }
}

function lireOuCreerConfig(chemin: string, hote: string): { machine: string; description: string } {
  const existante = lireConfig(chemin);
  if (existante) return existante;
  const config = { machine: nomMachineDepuisHote(hote), description: DESCRIPTION_PAR_DEFAUT };
  writeFileSync(chemin, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

// Un fichier absent ou invalide n'est pas une erreur : l'identifiant retombe sur le nom d'hôte.
function lireConfig(chemin: string): { machine: string; description: string } | null {
  let brut: unknown;
  try {
    brut = JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    return null;
  }
  const lu = FichierConfig.safeParse(brut);
  if (!lu.success || !lu.data.machine) return null;
  return { machine: lu.data.machine, description: lu.data.description ?? DESCRIPTION_PAR_DEFAUT };
}
