// Responsabilité : la CLI `noctis-nav <outil> [cle=valeur…]` — lit les arguments, appelle l'outil par le client,
// écrit le résultat en JSON compact sur stdout. Une erreur : le message sur stderr et le code 1.
// `noctis-nav aide` liste les outils.
import { appelerNav, OUTILS_NAV } from './client.mjs';

const DESCRIPTIONS = {
  ouvrir: 'ouvre le navigateur de la session, à l’adresse url=… si donnée',
  aller: 'va à l’adresse url=…',
  precedent: 'page précédente',
  recharger: 'recharge la page',
  fermer: 'ferme la vue de la session',
  etat: 'ouvert ? url et titre',
  lire: 'arbre de la page : une ligne par élément avec sa référence ref_N (filtre=interactifs|tout)',
  texte: 'texte principal de la page',
  trouver: 'cherche des éléments par texte, aria ou placeholder (requete=…)',
  cliquer: 'clique la référence ref=ref_N, ou la position x=… y=…',
  saisir: 'remplit le champ ref=… avec texte=…, valider=true pour Entrée',
  touche: 'touche sur l’élément actif (touche=Enter, Escape, Tab, ArrowDown…)',
  defiler: 'défile (direction=haut|bas, quantite=pixels)',
  executer: 'exécute une expression JS dans la page (js=…)',
};

export class ErreurUsage extends Error {}

/** La valeur d'un paramètre : true/false/null, nombre, JSON (`{`, `[`, `"`), sinon le texte tel quel. */
export function valeurCli(brut) {
  if (/^(true|false|null|-?\d+(\.\d+)?)$/.test(brut)) return JSON.parse(brut);
  if (!/^[{["]/.test(brut)) return brut;
  try {
    return JSON.parse(brut);
  } catch {
    throw new ErreurUsage(`JSON invalide : ${brut}`);
  }
}

/** Un paramètre `cle=valeur` : la clé est avant le premier `=`. */
export function lireParametre(texte) {
  const i = texte.indexOf('=');
  if (i <= 0) throw new ErreurUsage(`paramètre attendu : cle=valeur (reçu « ${texte} »)`);
  return [texte.slice(0, i), valeurCli(texte.slice(i + 1))];
}

/** Analyse la ligne de commande : `{ aide: true }` ou `{ outil, args }`. Un outil inconnu ou un paramètre faux lève. */
export function analyser(argv) {
  const [outil, ...reste] = argv;
  if (outil === undefined || outil === 'aide') return { aide: true };
  if (!OUTILS_NAV.includes(outil)) throw new ErreurUsage(`outil inconnu : ${outil} (noctis-nav aide liste les outils)`);
  return { aide: false, outil, args: Object.fromEntries(reste.map(lireParametre)) };
}

export function texteAide() {
  const lignes = OUTILS_NAV.map((outil) => `  ${outil.padEnd(10)} ${DESCRIPTIONS[outil]}`);
  return [
    'noctis-nav <outil> [cle=valeur…] : le navigateur de la session, en JSON sur stdout.',
    ...lignes,
    'Valeurs : texte brut, ou JSON (true, 3, {…}). Un texte qui ressemble à un nombre se met entre guillemets :',
    '  texte=\'"2026"\'.',
    'Lis (lire, texte) avant de cliquer : une référence ref_N ne vaut que jusqu’au prochain chargement de la page.',
    '',
  ].join('\n');
}

function messageDe(erreur) {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

const SORTIES_STANDARD = {
  sortie: (texte) => process.stdout.write(texte),
  erreur: (texte) => process.stderr.write(texte),
};

/** Exécute la CLI : rend le code de sortie (0 ou 1). Les dépendances sont injectables pour les tests. */
export async function executerCli(argv, sorties = SORTIES_STANDARD, appeler = appelerNav) {
  try {
    const lue = analyser(argv);
    if (lue.aide) {
      sorties.sortie(texteAide());
      return 0;
    }
    const resultat = await appeler(lue.outil, lue.args);
    sorties.sortie(`${JSON.stringify(resultat ?? null)}\n`);
    return 0;
  } catch (erreur) {
    sorties.erreur(`noctis-nav : ${messageDe(erreur)}\n`);
    return 1;
  }
}
