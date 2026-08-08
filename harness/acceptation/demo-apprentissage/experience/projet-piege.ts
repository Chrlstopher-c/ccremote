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
 * LE PIÈGE — configuration, pas raisonnement, donc reproductible :
 * la suite de tests n'a de sens que si `banc/amorce.ts` est PRÉCHARGÉ
 * (`bun test --preload ./banc/amorce.ts`). Sans lui, la table de taux n'existe pas et
 * l'échec se manifeste à l'intérieur de `src/tarif.ts` sous la forme
 * `TypeError: undefined is not an object (evaluating 'banc.taux')` — une pile qui
 * désigne le code métier alors que le code métier est correct. Vérifié en réel sur
 * Bun 1.3.13 : `bun test` sort 1 et « 0 pass / 3 fail », `bun test --preload
 * ./banc/amorce.ts` sort 0 et « 3 pass / 0 fail ».
 *
 * Le piège est DÉCOUVRABLE — sinon il n'y aurait pas de contraste, seulement deux
 * échecs : `docs/OUTILLAGE.md` et l'en-tête de `banc/amorce.ts` le disent tous les deux.
 * Ce qui coûte des tours, c'est que la pile d'erreur pousse ailleurs.
 */

/** La commande qui résout le piège. Sert au vérificateur, jamais à l'agent. */
export const COMMANDE_ATTENDUE = 'bun test --preload ./banc/amorce.ts';

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
 * Ce fichier n'est pas importé : il doit être PRÉCHARGÉ par le lanceur de tests.
 * Voir \`docs/OUTILLAGE.md\`.
 */
import type { TableBanc } from '../src/banc.ts';

const TABLE: TableBanc = {
  taux: { EUR: 1, USD: 1.0873, GBP: 0.8412, CHF: 0.9365 },
};

globalThis.__BANC_TARIFS__ = TABLE;
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

const DOCS_OUTILLAGE = `# Outillage

## Banc de taux

Le service ne code pas ses taux en dur : ils sont injectés à l'exécution par
l'environnement d'appel. En test, cette injection est faite par \`banc/amorce.ts\`,
qui doit être **préchargé** par le lanceur — un simple import depuis un test
arriverait trop tard, les modules de \`src/\` étant déjà évalués.

Bun expose ce préchargement par l'option \`--preload\`.

## Journal

Voir \`docs/CHANGELOG.md\`.
`;

const DOCS_CHANGELOG = `# Journal

## 0.3.1
- Arrondi monétaire extrait dans \`src/arrondi.ts\`.

## 0.3.0
- Les taux ne sont plus codés en dur dans \`src/tarif.ts\` : ils viennent du banc.
  La suite de tests ne passe plus sans l'amorce.

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
