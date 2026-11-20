// Responsabilité : appliquer UNE ligne du transcript à l'état agrégé — usage du dernier tour du fil principal, appels
// d'outils, résultats, notifications de fin de tâche, attachements d'état, demandes de fusion (pr-link).
import type { EtatTranscript, PrVue, UsageContexte } from './etat.ts';
import { appliquerEtatAttachement, appliquerNotifications } from './taches.ts';
import { appliquerAppelOutil, appliquerResultatOutil } from './outils.ts';
import { blocs, estObjet, nombre, texte, type Objet } from './lignes.ts';

export function appliquerLigne(etat: EtatTranscript, ligne: Objet): void {
  const le = texte(ligne['timestamp']) ?? '';
  switch (ligne['type']) {
    case 'assistant':
      return appliquerAssistant(etat, ligne, le);
    case 'user':
      return appliquerUtilisateur(etat, ligne, le);
    case 'attachment':
      return appliquerPieceJointe(etat, ligne, le);
    case 'pr-link':
      return appliquerPrLink(etat, ligne);
    default:
      return;
  }
}

function appliquerAssistant(etat: EtatTranscript, ligne: Objet, le: string): void {
  const message = ligne['message'];
  if (!estObjet(message)) return;
  const principal = ligne['isSidechain'] !== true;
  const usage = message['usage'];
  if (principal && estObjet(usage)) etat.contexte = usageDe(message, usage, le);
  for (const bloc of blocs(message['content'])) {
    if (bloc['type'] === 'tool_use') appliquerAppelOutil(etat, bloc, le, principal);
  }
}

function usageDe(message: Objet, usage: Objet, le: string): UsageContexte {
  const entrees = nombre(usage['input_tokens']);
  const relues = nombre(usage['cache_read_input_tokens']);
  const crees = nombre(usage['cache_creation_input_tokens']);
  return {
    modele: texte(message['model']),
    utilises: entrees + relues + crees,
    sortie: nombre(usage['output_tokens']),
    le,
  };
}

function appliquerUtilisateur(etat: EtatTranscript, ligne: Objet, le: string): void {
  const message = ligne['message'];
  if (!estObjet(message)) return;
  const contenu = message['content'];
  if (typeof contenu === 'string') return appliquerNotifications(etat, contenu, le);
  for (const bloc of blocs(contenu)) {
    if (bloc['type'] === 'tool_result') appliquerResultatOutil(etat, bloc, ligne['toolUseResult'], le);
    const t = texte(bloc['text']);
    if (bloc['type'] === 'text' && t !== null) appliquerNotifications(etat, t, le);
  }
}

function appliquerPieceJointe(etat: EtatTranscript, ligne: Objet, le: string): void {
  const piece = ligne['attachment'];
  if (estObjet(piece) && piece['type'] === 'task_status') appliquerEtatAttachement(etat, piece, le);
}

function appliquerPrLink(etat: EtatTranscript, ligne: Objet): void {
  const numero = ligne['prNumber'];
  const url = texte(ligne['prUrl']);
  const depot = texte(ligne['prRepository']);
  if (typeof numero !== 'number' || url === null || depot === null) return;
  const pr: PrVue = { numero, url, depot };
  etat.prs.set(depot, pr);
  etat.dernierePr = pr;
}
