// Responsabilité : le vocabulaire des machines configurées (connexion SSH) — validation des entrées et chemins distants.
// Pur : aucune I/O ici (la présence de la clé est vérifiée par le relais, pas par ce module).
import { z } from 'zod';

export const ID_MACHINE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HOTE = /^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/;
const UTILISATEUR = /^[a-z_][a-z0-9_-]{0,31}$/;
// Chemin absolu ou « ~ » / « ~/… » : jamais de saut de ligne ni d'octet nul (il finit dans une commande distante).
const CHEMIN = /^(~(\/[^\n\0]*)?|\/[^\n\0]*)$/;

// Les champs sans défaut servent aussi à la modification partielle : un PATCH ne doit jamais réinitialiser un champ
// absent (un `.default()` serait réappliqué par `.partial()`).
const HOTE_CHAMP = z.string().regex(HOTE, 'hôte invalide');
const PORT_CHAMP = z.number().int().min(1).max(65535);
const UTILISATEUR_CHAMP = z.string().regex(UTILISATEUR, 'utilisateur invalide');
const CLE_CHAMP = z.string().regex(/^\/[^\n\0]+$/, 'clé : chemin absolu attendu');
const DESCRIPTION_CHAMP = z.string().trim().max(200);
const DOSSIER_CHAMP = z.string().regex(CHEMIN, 'dossier : chemin absolu ou ~/…').max(1000);

export const ConfigMachine = z.object({
  id: z.string().regex(ID_MACHINE, 'identifiant : minuscules, chiffres, tirets (40 max)'),
  description: DESCRIPTION_CHAMP.default(''),
  hote: HOTE_CHAMP,
  port: PORT_CHAMP.default(22),
  utilisateur: UTILISATEUR_CHAMP,
  cle: CLE_CHAMP,
  dossier: DOSSIER_CHAMP.default('~'),
});
export type ConfigMachine = z.infer<typeof ConfigMachine>;

/** Modification partielle : tout sauf l'identifiant, qui ne change jamais. Aucun champ absent n'est rempli. */
export const ModifMachine = z.object({
  description: DESCRIPTION_CHAMP.optional(),
  hote: HOTE_CHAMP.optional(),
  port: PORT_CHAMP.optional(),
  utilisateur: UTILISATEUR_CHAMP.optional(),
  cle: CLE_CHAMP.optional(),
  dossier: DOSSIER_CHAMP.optional(),
});
export type ModifMachine = z.infer<typeof ModifMachine>;

/** Un chemin distant valide ? (absolu, ou « ~ » et « ~/… », sans saut de ligne) */
export function cheminValide(chemin: string): boolean {
  return chemin.length <= 1000 && CHEMIN.test(chemin);
}

/**
 * Quote un argument pour `sh` : entre apostrophes, les apostrophes internes échappées. Seul moyen de mettre une valeur
 * issue de l'API dans une commande distante.
 */
export function citer(valeur: string): string {
  return `'${valeur.replace(/'/g, `'\\''`)}'`;
}

/** Expression shell d'un chemin : « ~/x » devient "$HOME"/'x' (le tilde ne se développe pas entre apostrophes). */
export function cheminShell(chemin: string): string {
  if (chemin === '~') return '"$HOME"';
  if (chemin.startsWith('~/')) return `"$HOME"/${citer(chemin.slice(2))}`;
  return citer(chemin);
}
