// Responsabilité : l'écran de chargement du monde — l'étape en cours, puis les erreurs en clair à l'écran (sur téléphone,
// pas de console : c'est le seul moyen de savoir où le démarrage bloque). Disparaît quand le monde est posé.
let boite: HTMLDivElement | null = null;
let ligne: HTMLDivElement | null = null;
let erreurs: HTMLDivElement | null = null;

function creer(): void {
  if (boite) return;
  boite = document.createElement('div');
  boite.id = 'chargement';
  boite.innerHTML = '<div class="titre-pixel">Agent HQ</div><div class="etape"></div><div class="erreurs"></div>';
  ligne = boite.querySelector('.etape');
  erreurs = boite.querySelector('.erreurs');
  document.body.append(boite);
}

export function etapeChargement(texte: string): void {
  creer();
  if (ligne) ligne.textContent = texte;
}

export function erreurChargement(texte: string): void {
  creer();
  if (!erreurs || erreurs.childElementCount >= 6) return;
  const e = document.createElement('div');
  e.textContent = texte.slice(0, 300);
  erreurs.append(e);
}

export function finChargement(): void {
  if (!boite) return;
  if (erreurs?.childElementCount) {
    boite.classList.add('discret'); // le monde tourne, mais les erreurs restent lisibles
    if (ligne) ligne.textContent = 'monde prêt';
    return;
  }
  boite.remove();
  boite = null;
}

export function surveillerErreurs(): void {
  window.addEventListener('error', (e) => erreurChargement(`erreur : ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => erreurChargement(`erreur : ${String(e.reason)}`));
}
