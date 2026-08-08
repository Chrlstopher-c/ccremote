/**
 * Responsabilité : point d'entrée exécutable du générateur de page. Lit un
 * `FichierMesures`, le valide contre le contrat minimal, et écrit une page HTML
 * autonome. Refuse d'écrire si le fichier n'est pas conforme.
 *
 * Usage : bun run page/generer-page.ts <mesures.json> <sortie.html>
 * Par défaut (relatifs à ce fichier) : ../mesures.json et ../demonstration.html
 */

import type { FichierMesures } from '../experience/contrat.ts';
import { FEUILLE_DE_STYLE } from './theme.ts';
import { rendreBandeau } from './sections/bandeau.ts';
import { rendreEntete } from './sections/entete.ts';
import { rendreHermes } from './sections/hermes.ts';
import { rendreBoucle } from './sections/boucle.ts';
import { rendrePiege } from './sections/piege.ts';
import { rendreProtocole } from './sections/protocole.ts';
import { rendreMesures } from './sections/mesures.ts';
import { rendreOutils } from './sections/outils.ts';
import { rendreTraces } from './sections/traces.ts';
import { rendreSensInverse } from './sections/sens-inverse.ts';
import { rendreLimites } from './sections/limites.ts';
import { rendrePied } from './sections/pied.ts';

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null;
}

function verifierChampsRacine(donnees: Record<string, unknown>): string[] {
  const erreurs: string[] = [];
  if (donnees['version'] !== 1) erreurs.push('version doit valoir 1');
  if (typeof donnees['factice'] !== 'boolean') erreurs.push('factice doit être un booléen');
  if (typeof donnees['genereA'] !== 'string') erreurs.push('genereA doit être une chaîne');
  if (!estObjet(donnees['protocole'])) erreurs.push('protocole manquant ou invalide');
  if (!Array.isArray(donnees['executions'])) erreurs.push('executions manquant ou invalide (tableau attendu)');
  if (!Array.isArray(donnees['agregats'])) erreurs.push('agregats manquant ou invalide (tableau attendu)');
  if (!estObjet(donnees['traces'])) erreurs.push('traces manquant ou invalide');
  return erreurs;
}

const CHAMPS_CHAINE_PROTOCOLE = ['modele', 'piege', 'tache', 'mandatMotPourMot', 'critereSucces'] as const;

function verifierProtocole(protocole: Record<string, unknown>): string[] {
  const erreurs: string[] = [];
  for (const champ of CHAMPS_CHAINE_PROTOCOLE) {
    if (typeof protocole[champ] !== 'string') erreurs.push(`protocole.${champ} doit être une chaîne`);
  }
  if (typeof protocole['repetitionsParCondition'] !== 'number') {
    erreurs.push('protocole.repetitionsParCondition doit être un nombre');
  }
  if (!Array.isArray(protocole['conditions'])) erreurs.push('protocole.conditions doit être un tableau');
  if (!estObjet(protocole['blocsLecons'])) erreurs.push('protocole.blocsLecons doit être un objet');
  if (!Array.isArray(protocole['limites'])) erreurs.push('protocole.limites doit être un tableau');
  return erreurs;
}

/** Valide la forme MINIMALE exigée par `contrat.ts`. Rend la liste des erreurs (vide = conforme). */
function validerFichierMesures(donnees: unknown): string[] {
  if (!estObjet(donnees)) return ['le fichier ne contient pas un objet JSON'];
  const erreurs = verifierChampsRacine(donnees);
  const protocole = donnees['protocole'];
  if (estObjet(protocole)) erreurs.push(...verifierProtocole(protocole));
  return erreurs;
}

function assemblerDocument(m: FichierMesures, cheminMesures: string): string {
  const corps = [
    rendreBandeau(m),
    rendreEntete(m),
    rendreHermes(),
    rendreBoucle(),
    rendrePiege(m),
    rendreProtocole(m),
    rendreMesures(m),
    rendreOutils(m),
    rendreTraces(m),
    rendreSensInverse(m),
    rendreLimites(m),
    rendrePied(m, cheminMesures),
  ].join('\n');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Est-ce que le harness a appris ?</title>
<style>${FEUILLE_DE_STYLE}</style>
</head>
<body>
${corps}
</body>
</html>`;
}

interface Chemins {
  readonly entree: string;
  readonly sortie: string;
}

function resoudreChemins(argv: readonly string[]): Chemins {
  const base = new URL('.', import.meta.url);
  const entree = argv[0] ?? new URL('../mesures.json', base).pathname;
  const sortie = argv[1] ?? new URL('../demonstration.html', base).pathname;
  return { entree, sortie };
}

async function lireMesures(chemin: string): Promise<unknown> {
  try {
    const texte = await Bun.file(chemin).text();
    // Justifié : JSON.parse a un type de retour `any` implicite ; ce cast l'élargit vers
    // `unknown`, le type le plus sûr possible — aucune donnée n'est présumée valide ici.
    return JSON.parse(texte) as unknown;
  } catch (erreur) {
    console.error(`[generer-page] échec de lecture ou de parsing de ${chemin} :`, erreur);
    throw erreur;
  }
}

async function ecrireHtml(chemin: string, html: string): Promise<void> {
  try {
    await Bun.write(chemin, html);
  } catch (erreur) {
    console.error(`[generer-page] échec d'écriture de ${chemin} :`, erreur);
    throw erreur;
  }
}

async function main(): Promise<void> {
  const { entree, sortie } = resoudreChemins(process.argv.slice(2));
  const donnees = await lireMesures(entree);
  const erreurs = validerFichierMesures(donnees);
  if (erreurs.length > 0) {
    console.error(
      `[generer-page] ${entree} n'est pas un FichierMesures conforme au contrat — refus d'écrire :\n` +
        erreurs.map((e) => `  - ${e}`).join('\n'),
    );
    process.exit(1);
  }
  // Justifié : validerFichierMesures vient de vérifier la forme minimale exigée par contrat.ts
  // (version, factice, genereA, protocole et ses champs, executions/agregats/traces) juste au-dessus ;
  // écrire un type-predicate structurel complet dupliquerait ce contrat sans changer la garantie.
  const mesures = donnees as FichierMesures;
  const html = assemblerDocument(mesures, entree);
  await ecrireHtml(sortie, html);
  console.log(`[generer-page] page écrite dans ${sortie}`);
}

await main();
