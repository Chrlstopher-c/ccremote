// Responsabilité : la déclaration des deux outils `modules` ouverts aux agents hors de Lanterne (modules_lister,
// module_appeler) — descriptions et schémas. Source unique : le serveur `lanterne` en processus et le serveur MCP
// externe (mcp-externe.ts) les lisent tous deux ici, pour qu'ils restent identiques.
import { z } from 'zod';
import { DonneesModule, REGEX_ID_MODULE, REGEX_NOM_OUTIL } from '../../commun/modules.ts';

export const DESCRIPTION_MODULES_LISTER =
  'Lister les outils et les intégrations des modules Lanterne (extensions de l’appli de Chris : carte, etc.). ' +
  'À lire avant d’appeler un outil de module ou d’afficher une intégration.';

export const DESCRIPTION_MODULE_APPELER =
  'Appeler un outil d’un module Lanterne, tel que listé par modules_lister. Le résultat revient en texte. ' +
  'Échoue si aucune appli Lanterne n’est ouverte ou si le module n’y est pas actif.';

export const SCHEMA_MODULES_LISTER = {};

export const SCHEMA_MODULE_APPELER = {
  module: z.string().regex(REGEX_ID_MODULE),
  outil: z.string().regex(REGEX_NOM_OUTIL),
  arguments: DonneesModule.optional(),
};
