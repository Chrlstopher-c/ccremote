// Responsabilité : l'environnement que le poste donne à chaque session pilotée (tmux ou SDK) pour la CLI `noctis-nav` :
// le dossier de la CLI en tête du PATH, et le chemin du client JS pour un `import` depuis un script. En développement,
// c'est le dossier source ; dans le binaire compilé, la CLI est extraite au démarrage (poste/nav/extraction.ts) et ce
// dossier-là est fixé ; sans extraction, la CLI n'est pas offerte aux sessions.
import { delimiter, join } from 'node:path';

export const DOSSIER_NAV = import.meta.dir;
export const CHEMIN_CLIENT_NAV = join(DOSSIER_NAV, 'client.mjs');
export const VAR_CLIENT_NAV = 'NOCTIS_NAV_CLIENT';

/** Vrai pour un module chargé depuis le binaire compilé (`/$bunfs` sous Linux, `~BUN` sous Windows). */
export function enBinaire(dossier: string): boolean {
  return dossier.startsWith('/$bunfs') || /[\\/]~BUN([\\/]|$)/.test(dossier);
}

let dossierCourant: string | null = enBinaire(DOSSIER_NAV) ? null : DOSSIER_NAV;

/** Le dossier où se trouve la CLI pour les sessions, ou null quand elle n'est pas disponible. */
export function dossierNav(): string | null {
  return dossierCourant;
}

export function fixerDossierNav(dossier: string | null): void {
  dossierCourant = dossier;
}

/** Le PATH de la session (dossier de la CLI d'abord, puis le PATH du poste) et la variable du client. */
export function environnementNav(cheminPoste: string | undefined): Record<string, string> {
  const dossier = dossierNav();
  const tete = cheminPoste ?? '';
  if (!dossier) return tete ? { PATH: tete } : {};
  const chemin = [dossier, tete].filter((b) => b.length > 0).join(delimiter);
  return { PATH: chemin, [VAR_CLIENT_NAV]: join(dossier, 'client.mjs') };
}
