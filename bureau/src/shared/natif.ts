// Responsabilité : ce que seule l'app de bureau sait faire — ouvrir un terminal attaché, notifier le système.
// Dans un navigateur (repli web servi par le relais), ces fonctions se dégradent sans erreur.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { journal } from './journal.ts';

export const estBureau = (): boolean => isTauri();

export async function ouvrirTerminal(machine: string, tmux: string): Promise<string | null> {
  if (!estBureau()) return 'disponible dans l’app de bureau seulement';
  try {
    await invoke('ouvrir_terminal', { machine, tmux });
    return null;
  } catch (erreur) {
    journal.warn({ machine, tmux, erreur: String(erreur) }, 'terminal non ouvert');
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
