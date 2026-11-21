// Responsabilité : l'API des modules pour les clients — liste des modules du parc et service de leurs fichiers.
// Un fichier se sert sous l'origine de l'appli, à `modules/<id>/<chemin>` ; un chemin qui sort du module est refusé.
import { cheminModuleValide, type EtatServeur } from '../../commun/modules.ts';
import { estModuleDuo } from '../../commun/duo.ts';
import { erreur, json } from '../clients/http.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import type { ModuleRelais } from './registre-modules.ts';

const TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

export function typeMime(chemin: string): string {
  const extension = chemin.split('.').pop()?.toLowerCase() ?? '';
  return TYPES[extension] ?? 'application/octet-stream';
}

export interface VueServeur {
  readonly machine: string;
  readonly etat: EtatServeur;
  readonly erreur: string | null;
}

/** Le serveur d'un module tel que les clients le voient ; un poste hors ligne n'en fait plus tourner aucun. */
export function vueServeur(m: ModuleRelais, enLigne?: (machine: string) => boolean): VueServeur | null {
  const declare = m.manifeste?.serveur;
  if (declare === undefined) return null;
  const machine = declare.machine ?? m.machine;
  // Un module reçu du pair tourne chez le propriétaire : son état nous vient par le lien, pas d'un poste local.
  if (enLigne && !estModuleDuo(m.machine) && !enLigne(machine)) {
    return { machine, etat: 'arrete', erreur: `${machine} est hors ligne` };
  }
  return { machine, etat: m.serveur?.etat ?? 'arrete', erreur: m.serveur?.erreur ?? null };
}

export function lireModules(registre: Registre, postes?: Pick<Postes, 'enLigne'>): Response {
  const enLigne = postes ? (machine: string) => postes.enLigne(machine) : undefined;
  return json(registre.modules.lister().map((m) => ({ ...m, serveur: vueServeur(m, enLigne) })));
}

/** `GET /api/modules/<id>/<chemin>` : le fichier du module, avec son type MIME. */
export function servirFichierModule(registre: Registre, req: Request): Response {
  const [, , , id = '', ...segments] = new URL(req.url).pathname.split('/');
  let chemin: string;
  try {
    chemin = segments.map((s) => decodeURIComponent(s)).join('/');
  } catch {
    return erreur('chemin illisible', 400);
  }
  if (!cheminModuleValide(chemin)) return erreur('chemin refusé', 400);
  const fichier = registre.modules.fichier(decodeURIComponent(id), chemin);
  if (fichier === null) return erreur('fichier introuvable', 404);
  return new Response(Buffer.from(fichier.base64, 'base64'), {
    headers: { 'content-type': typeMime(chemin), 'cache-control': 'no-cache' },
  });
}
