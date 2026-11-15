// Responsabilité : le lien entre le monde (Phaser) et l'interface (React) — quel panneau est ouvert. Le jeu demande
// l'ouverture (clic sur un agent, un meuble), l'interface l'affiche ; un seul panneau à la fois.
export type Panneau =
  | { type: 'agent'; sessionId: string }
  | { type: 'terminal'; machine: string; cwd?: string; titre?: string }
  | { type: 'fichiers'; machine: string; chemin: string; sessionId?: string }
  | { type: 'reunion' }
  | { type: 'nouvelle' };

type Ecouteur = (p: Panneau | null) => void;

let courant: Panneau | null = null;
const ecouteurs = new Set<Ecouteur>();

export function ouvrir(p: Panneau): void {
  courant = p;
  for (const e of ecouteurs) e(p);
}

export function fermer(): void {
  courant = null;
  for (const e of ecouteurs) e(null);
}

export function panneauCourant(): Panneau | null {
  return courant;
}

export function ecouterPanneau(e: Ecouteur): () => void {
  ecouteurs.add(e);
  return () => ecouteurs.delete(e);
}
