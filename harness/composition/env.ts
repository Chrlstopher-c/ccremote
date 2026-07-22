/**
 * Responsabilité : lecture stricte des variables d'environnement de composition.
 *
 * `☠` Aucune valeur sensible codée en dur (mission) : tout ce qui distingue un
 * déploiement d'un autre (ports, chemins, seuils) vient d'ici, jamais d'une
 * constante. Une variable obligatoire absente est un échec BRUYANT au
 * démarrage (H-74, point 2) — jamais une valeur par défaut silencieuse pour
 * ce qui touche un garde-fou ou une adresse réseau.
 */

export class EnvManquantError extends Error {
  constructor(nom: string) {
    super(`variable d'environnement obligatoire absente : ${nom} (voir .env.example)`);
    this.name = 'EnvManquantError';
  }
}

export function envObligatoire(nom: string): string {
  const valeur = process.env[nom];
  if (valeur === undefined || valeur === '') throw new EnvManquantError(nom);
  return valeur;
}

export function envOptionnel(nom: string, defaut: string): string {
  const valeur = process.env[nom];
  return valeur === undefined || valeur === '' ? defaut : valeur;
}

export function envNombreOptionnel(nom: string, defaut: number): number {
  const valeur = process.env[nom];
  if (valeur === undefined || valeur === '') return defaut;
  const nombre = Number(valeur);
  if (!Number.isFinite(nombre)) throw new Error(`variable d'environnement ${nom} n'est pas un nombre valide : "${valeur}"`);
  return nombre;
}

export function envSeuilPctOptionnel(nom: string): number | undefined {
  const valeur = process.env[nom];
  if (valeur === undefined || valeur === '') return undefined;
  const nombre = Number(valeur);
  if (!Number.isFinite(nombre) || nombre < 0 || nombre > 100) {
    throw new Error(`variable d'environnement ${nom} doit être un pourcentage 0-100 : "${valeur}"`);
  }
  return nombre;
}
