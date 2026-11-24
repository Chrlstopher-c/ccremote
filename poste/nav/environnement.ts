// Responsabilité : l'environnement que le poste donne à chaque session pilotée (tmux ou SDK) pour la CLI `noctis-nav` :
// son dossier en tête du PATH, et le chemin du client JS pour un `import` depuis un script.
import { delimiter, join } from 'node:path';

export const DOSSIER_NAV = import.meta.dir;
export const CHEMIN_CLIENT_NAV = join(DOSSIER_NAV, 'client.mjs');
export const VAR_CLIENT_NAV = 'NOCTIS_NAV_CLIENT';

/** Le PATH de la session (dossier de la CLI d'abord, puis le PATH du poste) et la variable du client. */
export function environnementNav(cheminPoste: string | undefined): Record<string, string> {
  const chemin = [DOSSIER_NAV, cheminPoste ?? ''].filter((b) => b.length > 0).join(delimiter);
  return { PATH: chemin, [VAR_CLIENT_NAV]: CHEMIN_CLIENT_NAV };
}
