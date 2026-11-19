// Responsabilité : lire les options de migrer-fiches et refuser une commande incomplète avant toute écriture.
import { resolve } from 'node:path';

export interface OptionsTour {
  readonly hote: string;
  readonly utilisateur: string;
  readonly port: number;
  readonly cle: string;
  readonly description: string;
}

export interface OptionsMigration {
  readonly source: string;
  readonly cible: string;
  readonly machineLocale: string;
  readonly simulation: boolean;
  readonly tour: OptionsTour | null;
}

const AVEC_VALEUR = new Set([
  '--source',
  '--cible',
  '--machine-locale',
  '--tour-hote',
  '--tour-utilisateur',
  '--tour-port',
  '--tour-cle',
  '--tour-description',
]);
const SANS_VALEUR = new Set(['--simulation', '--help']);

export const AIDE = `usage : bun scripts/migration/migrer-fiches.ts --source <copie de relais.db>
  --cible <relais.db intégré> --machine-locale <id> [--simulation]
  [--tour-hote <hôte> --tour-utilisateur <utilisateur> --tour-cle <clé>
   [--tour-port <port>] [--tour-description <texte>]]`;

function valeurs(argv: readonly string[]): Map<string, string> {
  const lues = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i] ?? '';
    if (SANS_VALEUR.has(option)) {
      lues.set(option, '');
      continue;
    }
    if (!AVEC_VALEUR.has(option)) throw new Error(`option inconnue : ${option}`);
    const valeur = argv[i + 1];
    if (valeur === undefined || valeur.startsWith('--')) throw new Error(`${option} : valeur manquante`);
    lues.set(option, valeur);
    i++;
  }
  return lues;
}

function lireTour(lues: Map<string, string>): OptionsTour | null {
  const requis = ['--tour-hote', '--tour-utilisateur', '--tour-cle'];
  const presents = requis.filter((nom) => lues.has(nom));
  if (presents.length === 0) return null;
  if (presents.length < requis.length) {
    throw new Error('--tour-hote, --tour-utilisateur et --tour-cle vont ensemble');
  }
  const port = Number(lues.get('--tour-port') ?? '22');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--tour-port : port invalide');
  return {
    hote: lues.get('--tour-hote') ?? '',
    utilisateur: lues.get('--tour-utilisateur') ?? '',
    cle: lues.get('--tour-cle') ?? '',
    port,
    description: lues.get('--tour-description') ?? 'Tour',
  };
}

export function estAide(argv: readonly string[]): boolean {
  return argv.includes('--help');
}

export function lireOptions(argv: readonly string[]): OptionsMigration {
  const lues = valeurs(argv);
  const requis = (nom: string): string => {
    const valeur = lues.get(nom);
    if (!valeur) throw new Error(`${nom} requis`);
    return valeur;
  };
  const source = requis('--source');
  const cible = requis('--cible');
  if (resolve(source) === resolve(cible)) throw new Error('la source et la cible sont le même fichier');
  return {
    source,
    cible,
    machineLocale: requis('--machine-locale'),
    simulation: lues.has('--simulation'),
    tour: lireTour(lues),
  };
}
