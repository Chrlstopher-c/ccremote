// Responsabilité : le nom d'utilisateur qu'un poste ou un relais annonce à son pair (mode duo). Pur : l'environnement
// et le compte système sont passés en paramètres.
export function nomUtilisateur(env: Readonly<Record<string, string | undefined>>, compteSysteme: string): string {
  const surcharge = env['LANTERNE_UTILISATEUR']?.trim();
  return surcharge ? surcharge : compteSysteme;
}
