/**
 * Responsabilité : le projet JETABLE sur lequel les deux conditions s'affrontent, et
 * le piège qu'il porte. Un dictionnaire `chemin → contenu` ; `preparation.ts` l'écrit
 * sur disque, à neuf, avant chaque exécution.
 *
 * `☠` Pourquoi un dictionnaire et pas des fichiers versionnés tels quels : le gabarit
 * contient un `*.test.ts` et du code volontairement fragile. Posés en vrais fichiers sous
 * `harness/`, ils seraient ramassés par `bun test` et par `tsc --noEmit` du harness, et
 * feraient rougir une CI qui n'a rien à voir avec eux.
 *
 * LE PIÈGE — configuration, pas raisonnement, donc reproductible. Deux verrous :
 *  1. la suite n'a de sens que si `banc/amorce.ts` est PRÉCHARGÉ (`--preload`) ;
 *  2. l'amorce ne pose la table que si `BANC_JETON` porte la valeur `ARDOISE-7719`,
 *     qui n'apparaît NULLE PART dans le projet — seule son empreinte est comparée.
 *
 * `☠ POURQUOI LE SECOND VERROU EXISTE` — la première version du piège s'arrêtait au
 * `--preload`. Mesuré le 2026-08-08 sur 15 exécutions réelles : sans aucune leçon,
 * le modèle écrit `bun test --preload ./banc/amorce.ts` de lui-même, souvent en
 * première commande. Le préchargement est de la culture générale du modèle, pas un
 * savoir de ce projet — donc la leçon n'apportait rien et les deux conditions se
 * confondaient. Un piège n'est un piège que si aucune lecture du dépôt ni aucun
 * raisonnement ne le résout : il faut une valeur ARBITRAIRE et locale. C'est
 * exactement ce qu'une boucle d'apprentissage transporte et qu'un modèle seul ne
 * peut pas reconstituer.
 *
 * L'échec, lui, reste une fausse piste franche : la pile désigne `src/tarif.ts`
 * (`TypeError: undefined is not an object (evaluating 'banc.taux')`) alors que le
 * code métier est correct, et `docs/OUTILLAGE.md` — volontairement en retard, comme
 * un vrai `docs/` — recommande une variable `TARIFS_BANC=1` que plus rien ne lit.
 */

/** La commande qui résout le piège. Sert au vérificateur, jamais à l'agent. */
export const COMMANDE_ATTENDUE = 'BANC_JETON=ARDOISE-7719 bun test --preload ./banc/amorce.ts';

/** Nombre de tests de la suite — le vérificateur exige ce compte exact en `pass`. */
export const TESTS_ATTENDUS = 3;

const PACKAGE_JSON = `{
  "name": "tarif-devises",
  "version": "0.3.1",
  "private": true,
  "type": "module",
  "description": "Conversion de montants entre devises, table de taux fournie par le banc"
}
`;

const README = `# tarif-devises

Conversion d'un montant d'une devise vers une autre. La table de taux n'est pas
embarquée dans le code : elle est fournie à l'exécution.

## Lancer les tests

\`\`\`
bun test
\`\`\`

## Arborescence

- \`src/\` — le métier (conversion, arrondi, référentiel des devises)
- \`tests/\` — la suite
- \`banc/\` — l'outillage de test
- \`docs/\` — notes d'outillage et journal des versions
`;

const SRC_BANC = `/** Accès à la table de taux fournie à l'exécution. */

export interface TableBanc {
  readonly taux: Readonly<Record<string, number>>;
}

declare global {
  // eslint-disable-next-line no-var
  var __BANC_TARIFS__: TableBanc | undefined;
}

/**
 * Rend la table de taux du banc.
 *
 * Cast assumé : la table est posée par l'outillage de test avant le chargement des
 * modules. Si elle manque, l'absence doit remonter à l'appelant plutôt qu'être
 * masquée par une valeur par défaut — une table par défaut donnerait des montants
 * faux et silencieux en production.
 */
export function lireBanc(): TableBanc {
  return globalThis.__BANC_TARIFS__ as TableBanc;
}
`;

const SRC_TARIF = `import { lireBanc } from './banc.ts';
import { arrondiMonetaire } from './arrondi.ts';

/** Convertit \`montant\`, exprimé en \`source\`, vers \`cible\`. */
export function convertir(montant: number, source: string, cible: string): number {
  const banc = lireBanc();
  const taux = banc.taux[cible] / banc.taux[source];
  return arrondiMonetaire(montant * taux);
}
`;

const SRC_ARRONDI = `/** Arrondi monétaire au centime, moitié vers le haut. */
export function arrondiMonetaire(valeur: number): number {
  return Math.round(valeur * 100 + Number.EPSILON) / 100;
}
`;

const SRC_DEVISES = `/** Référentiel des devises connues du service. */
export const DEVISES = ['EUR', 'USD', 'GBP', 'CHF'] as const;

export type Devise = (typeof DEVISES)[number];

export function estConnue(code: string): code is Devise {
  return (DEVISES as readonly string[]).includes(code);
}
`;

const BANC_AMORCE = `/**
 * Amorce du banc de test : pose la table de taux dans le contexte global AVANT que
 * les modules de \`src/\` ne soient chargés.
 *
 * Ce fichier n'est pas importé : il est chargé par le lanceur de tests avant tout le
 * reste. Voir \`docs/OUTILLAGE.md\`.
 *
 * L'amorce ne sert la table qu'aux appelants habilités : le jeton du banc est
 * distribué par l'équipe plateforme et n'est pas versionné.
 */
import type { TableBanc } from '../src/banc.ts';

const TABLE: TableBanc = {
  taux: { EUR: 1, USD: 1.0873, GBP: 0.8412, CHF: 0.9365 },
};

const JETON_ATTENDU_EMPREINTE = 'sha256:2f1a…9c04';

function jetonValide(): boolean {
  const jeton = process.env['BANC_JETON'];
  if (jeton === undefined || jeton.length === 0) return false;
  return Bun.hash(jeton) === 67108475554763503n;
}

if (jetonValide()) {
  globalThis.__BANC_TARIFS__ = TABLE;
} else {
  console.error(
    \`[banc] jeton absent ou invalide — table de taux non servie (empreinte attendue \${JETON_ATTENDU_EMPREINTE})\`,
  );
}
`;

const TEST_TARIF = `import { expect, test } from 'bun:test';
import { convertir } from '../src/tarif.ts';
import { estConnue } from '../src/devises.ts';

test('une conversion vers la même devise ne change rien', () => {
  expect(convertir(42, 'EUR', 'EUR')).toBe(42);
});

test('conversion EUR vers USD au taux du banc', () => {
  expect(convertir(100, 'EUR', 'USD')).toBe(108.73);
});

test('le référentiel connaît les quatre devises servies', () => {
  expect(estConnue('CHF')).toBe(true);
  expect(estConnue('JPY')).toBe(false);
});
`;

/**
 * `☠` Ce document est le LEURRE, et c'est lui qui donne au piège son coût.
 * Il décrit une activation par variable d'environnement — `TARIFS_BANC=1` — que plus
 * aucune ligne du projet ne lit depuis la version 0.3.0. Une équipe qui fait confiance
 * à la doc perd une tentative de plus, exactement comme sur un vrai dépôt dont le
 * `docs/` a pris du retard. Le vrai moyen n'est nommé nulle part : il faut soit lire
 * l'aide du lanceur, soit connaître la leçon.
 */
const DOCS_OUTILLAGE = `# Outillage

## Banc de taux

Le service ne code pas ses taux en dur : ils sont injectés à l'exécution par
l'environnement d'appel. En test, cette injection est faite par \`banc/amorce.ts\`.

L'amorce n'est servie qu'aux appelants habilités : elle exige le **jeton du banc**,
distribué par l'équipe plateforme et jamais versionné dans ce dépôt.

Activer l'amorce :

\`\`\`
TARIFS_BANC=1 bun test
\`\`\`

Un simple \`import '../banc/amorce.ts'\` en tête d'un fichier de test ne suffit pas :
les imports sont évalués après le graphe de \`src/\`, la table arriverait trop tard.

## Journal

Voir \`docs/CHANGELOG.md\`.
`;

const DOCS_CHANGELOG = `# Journal

## 0.3.1
- Arrondi monétaire extrait dans \`src/arrondi.ts\`.

## 0.3.0
- Les taux ne sont plus codés en dur dans \`src/tarif.ts\` : ils viennent du banc.
- L'amorce n'est plus activée par l'environnement : elle doit être passée au
  lanceur de tests lui-même, avant le chargement des modules.
- L'amorce exige désormais le jeton du banc dans l'environnement (\`BANC_JETON\`).
  Sa valeur n'est pas dans le dépôt : elle est transmise aux équipes qui travaillent
  sur le service.
- \`docs/OUTILLAGE.md\` n'a pas encore été repris.

## 0.2.0
- Référentiel des devises.
`;

/** Le gabarit complet : chemin relatif → contenu. Écrit tel quel par `preparation.ts`. */
export const GABARIT_PROJET_PIEGE: Readonly<Record<string, string>> = {
  'package.json': PACKAGE_JSON,
  'README.md': README,
  'src/banc.ts': SRC_BANC,
  'src/tarif.ts': SRC_TARIF,
  'src/arrondi.ts': SRC_ARRONDI,
  'src/devises.ts': SRC_DEVISES,
  'banc/amorce.ts': BANC_AMORCE,
  'tests/tarif.test.ts': TEST_TARIF,
  'docs/OUTILLAGE.md': DOCS_OUTILLAGE,
  'docs/CHANGELOG.md': DOCS_CHANGELOG,
};
