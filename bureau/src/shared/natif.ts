// Responsabilité : ce que seule l'app de bureau sait faire — ouvrir un terminal attaché, un lien, notifier.
// Dans un navigateur (repli web servi par le relais), ces fonctions se dégradent sans erreur.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { journal } from './journal.ts';

export const estBureau = (): boolean => isTauri();

/** \`utilisateur\` : le compte Unix du poste distant (sur le Pi, \`pi\` et non le compte SSH par défaut). */
export async function ouvrirTerminal(machine: string, tmux: string, utilisateur?: string): Promise<string | null> {
  if (!estBureau()) return 'disponible dans l’app de bureau seulement';
  try {
    await invoke('ouvrir_terminal', { machine, tmux, utilisateur: utilisateur ?? null });
    return null;
  } catch (erreur) {
    journal.warn({ machine, tmux, erreur: String(erreur) }, 'terminal non ouvert');
    return String(erreur);
  }
}

/** La page de connexion d'un compte Claude, dans le navigateur de l'utilisateur. */
export async function ouvrirLien(url: string): Promise<string | null> {
  if (!estBureau()) {
    window.open(url, '_blank', 'noopener');
    return null;
  }
  try {
    await invoke('ouvrir_lien', { url });
    return null;
  } catch (erreur) {
    journal.warn({ erreur: String(erreur) }, 'lien non ouvert');
    return String(erreur);
  }
}

export async function notifierSysteme(titre: string, texte: string): Promise<void> {
  if (!estBureau()) return;
  try {
    let permis = await isPermissionGranted();
    if (!permis) permis = (await requestPermission()) === 'granted';
    if (permis) sendNotification({ title: titre, body: texte });
  } catch (erreur) {
    journal.warn({ erreur: String(erreur) }, 'notification système impossible');
  }
}

/** Enregistre un fichier vu dans le fil : Téléchargements/Quart sur le bureau, téléchargement du navigateur en web. */
export async function enregistrerFichier(nom: string, blob: Blob): Promise<{ chemin: string } | { erreur: string }> {
  if (!estBureau()) {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: nom }).click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { chemin: nom };
  }
  try {
    const octets = Array.from(new Uint8Array(await blob.arrayBuffer()));
    return { chemin: await invoke<string>('enregistrer_fichier', { nom, octets }) };
  } catch (erreur) {
    journal.warn({ nom, erreur: String(erreur) }, 'fichier non enregistré');
    return { erreur: String(erreur) };
  }
}

/** Ouvre un fichier vu dans le fil dans le navigateur (bureau : copie dans Téléchargements/Quart d'abord). */
export async function ouvrirDansNavigateur(nom: string, blob: Blob): Promise<string | null> {
  if (!estBureau()) {
    window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    return null;
  }
  const r = await enregistrerFichier(nom, blob);
  if ('erreur' in r) return r.erreur;
  try {
    await invoke('ouvrir_dans_navigateur', { chemin: r.chemin });
    return null;
  } catch (erreur) {
    journal.warn({ nom, erreur: String(erreur) }, 'ouverture dans le navigateur impossible');
    return String(erreur);
  }
}
