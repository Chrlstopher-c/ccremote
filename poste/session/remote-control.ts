// Responsabilité : Remote Control dans le TUI — `/remote-control` tapé dans la session tmux, son URL relevée à l'écran,
// sa déconnexion par le dialogue, la sortie du TUI. Les lectures d'écran sont pures (testées) ; les gestes passent
// par tmux, comme une saisie au clavier.
import * as tmux from './tmux.ts';

export type ResultatControle = { readonly erreur: string } | { readonly url: string | null };

// L'URL peut être repliée sur la ligne suivante (pane de 80 colonnes) : la recherche traverse les retours à la ligne.
const URL_CONTROLE = /is active\b[\s\S]{0,300}?(https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+)/;
const LIBELLE_DECONNEXION = 'Disconnect this session';
const CONFIRMATION_DECONNEXION = 'Remote Control disconnected.';
const OPTION_COURANTE = /^\s*❯\s+(Disconnect this session|Show QR code|Continue)\b/;
const DELAI_PRET_MS = 20_000;
const DELAI_URL_MS = 20_000;
const DELAI_DIALOGUE_MS = 10_000;
const DELAI_CONFIRMATION_MS = 10_000;
const DELAI_SORTIE_MS = 15_000;
const PERIODE_MS = 500;

/** URL de la session connectée, lue dans « /remote-control is active · … » ; null tant que l'écran ne la montre pas. */
export function urlDeControle(ecran: string): string | null {
  return URL_CONTROLE.exec(ecran)?.[1] ?? null;
}

/** Le TUI attend une commande : son invite et sa barre de pied sont à l'écran. */
export function estPret(ecran: string): boolean {
  return /^❯/m.test(ecran) && /shortcuts|bypass permissions|shift\+tab/.test(ecran);
}

/** Dialogue Remote Control ouvert : touches Haut (positif) ou Bas (négatif) pour amener le curseur sur la déconnexion. */
export function deplacementVersDeconnexion(ecran: string): number | null {
  if (!ecran.includes(LIBELLE_DECONNEXION)) return null;
  const lignes = ecran.split('\n');
  const cible = lignes.findIndex((ligne) => ligne.includes(LIBELLE_DECONNEXION));
  const courante = lignes.findIndex((ligne) => OPTION_COURANTE.test(ligne));
  return courante < 0 ? null : courante - cible;
}

export function deconnexionConfirmee(ecran: string): boolean {
  return ecran.includes(CONFIRMATION_DECONNEXION);
}

/** Relit l'écran jusqu'à ce que `lire` donne une valeur (`null` = pas encore) ; `null` au délai. */
export async function attendre<T>(lire: () => Promise<T | null>, delaiMs: number): Promise<T | null> {
  const fin = Date.now() + delaiMs;
  for (;;) {
    const valeur = await lire();
    if (valeur !== null) return valeur;
    if (Date.now() >= fin) return null;
    await Bun.sleep(PERIODE_MS);
  }
}

async function ecran(nom: string): Promise<string | null> {
  return tmux.capturer(nom);
}

/** Une commande tapée caractère par caractère puis envoyée, comme au clavier (ni collage ni autocomplétion). */
async function taperCommande(nom: string, texte: string): Promise<string | null> {
  const tape = await tmux.taper(nom, texte);
  if (tape.code !== 0) return tape.erreur;
  await Bun.sleep(300);
  const entree = await tmux.touche(nom, 'Enter');
  return entree.code === 0 ? null : entree.erreur;
}

/** Connecte (ON) ou déconnecte (OFF) Remote Control dans le TUI de la session tmux `nom`. */
export async function basculerDansTui(nom: string, actif: boolean): Promise<ResultatControle> {
  return actif ? activerDansTui(nom) : desactiverDansTui(nom);
}

async function activerDansTui(nom: string): Promise<ResultatControle> {
  const pret = await attendre(async () => {
    const texte = await ecran(nom);
    return texte !== null && estPret(texte) ? true : null;
  }, DELAI_PRET_MS);
  if (pret === null) return { erreur: 'Claude ne répond pas dans sa session tmux' };
  const erreur = await taperCommande(nom, '/remote-control');
  if (erreur) return { erreur };
  const url = await attendre(async () => {
    const texte = await ecran(nom);
    return texte === null ? null : urlDeControle(texte);
  }, DELAI_URL_MS);
  return url ? { url } : { erreur: 'Remote Control : aucune URL à l’écran au bout de 20 s' };
}

async function desactiverDansTui(nom: string): Promise<ResultatControle> {
  const erreur = await taperCommande(nom, '/remote-control');
  if (erreur) return { erreur };
  const pas = await attendre(async () => {
    const texte = await ecran(nom);
    return texte === null ? null : deplacementVersDeconnexion(texte);
  }, DELAI_DIALOGUE_MS);
  if (pas === null) return { erreur: 'dialogue Remote Control introuvable à l’écran' };
  for (let i = 0; i < Math.abs(pas); i++) {
    await tmux.touche(nom, pas > 0 ? 'Up' : 'Down');
    await Bun.sleep(150);
  }
  await tmux.touche(nom, 'Enter');
  const confirme = await attendre(async () => {
    const texte = await ecran(nom);
    return texte !== null && deconnexionConfirmee(texte) ? true : null;
  }, DELAI_CONFIRMATION_MS);
  return confirme ? { url: null } : { erreur: 'déconnexion de Remote Control non confirmée à l’écran' };
}

/** Quitte le TUI par `/exit`. Sans sortie au délai, la session tmux est arrêtée (son transcript reste). */
export async function sortirDuTui(nom: string): Promise<string | null> {
  const erreur = await taperCommande(nom, '/exit');
  if (erreur) return erreur;
  const parti = await attendre(async () => ((await tmux.existe(nom)) ? null : true), DELAI_SORTIE_MS);
  if (parti) return null;
  const arret = await tmux.tuer(nom);
  return arret.code === 0 ? null : arret.erreur;
}
