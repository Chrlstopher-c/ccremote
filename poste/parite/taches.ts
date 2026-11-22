// Responsabilité : le cycle des tâches en arrière-plan du transcript — ouverture (Agent ou Bash en arrière-plan), lien
// à leur identifiant d'exécution, fin par notification, par attachement ou par arrêt. Pur : ne lit aucun fichier.
import type { StatutTacheParite } from '../../commun/parite.ts';
import type { EtatTranscript, TacheVue } from './etat.ts';
import { texte, type Objet } from './lignes.ts';

const BALISE_NOTIFICATION = /<task-notification>([\s\S]*?)<\/task-notification>/g;

export interface NouvelleTache {
  readonly id: string;
  readonly genre: 'agent' | 'commande';
  readonly description: string;
  readonly debutLe: string;
  readonly prompt: string | null;
  readonly modele: string | null;
  readonly echeance?: string | null;
}

/** Statut final d'une fin rapportée par le transcript ; null pour un statut qui n'en est pas une. */
export function statutDeFin(valeur: string | null): StatutTacheParite | null {
  switch (valeur) {
    case 'completed':
      return 'terminee';
    case 'failed':
    case 'error':
      return 'echouee';
    case 'killed':
    case 'stopped':
      return 'arretee';
    default:
      return null;
  }
}

export function ouvrirTache(etat: EtatTranscript, nouvelle: NouvelleTache): TacheVue {
  const tache: TacheVue = {
    ...nouvelle,
    statut: 'en_cours',
    finLe: null,
    tacheId: null,
    sortie: null,
    notifiee: false,
    echeance: nouvelle.echeance ?? null,
  };
  etat.taches.set(nouvelle.id, tache);
  return tache;
}

export function lierIdentifiant(etat: EtatTranscript, tache: TacheVue, tacheId: string): void {
  tache.tacheId = tacheId;
  etat.tachesParTacheId.set(tacheId, tache.id);
}

export function cloreTache(tache: TacheVue, statut: StatutTacheParite, le: string, sortie: string | null): void {
  tache.statut = statut;
  tache.finLe = le;
  tache.notifiee = true;
  tache.sortie ??= sortie;
}

/** Tâche visée par un identifiant de tool_use, ou à défaut par un identifiant d'exécution. */
export function trouverTache(etat: EtatTranscript, id: string | null, tacheId: string | null): TacheVue | null {
  const parId = id === null ? undefined : etat.taches.get(id);
  if (parId) return parId;
  const parExecution = tacheId === null ? undefined : etat.tachesParTacheId.get(tacheId);
  return parExecution === undefined ? null : (etat.taches.get(parExecution) ?? null);
}

/** Chaque `<task-notification>` du texte clôt sa tâche (par tool-use-id, sinon par task-id). Le plus récent gagne. */
export function appliquerNotifications(etat: EtatTranscript, contenu: string, le: string): void {
  for (const m of contenu.matchAll(BALISE_NOTIFICATION)) {
    const corps = m[1] ?? '';
    const tache = trouverTache(etat, balise(corps, 'tool-use-id'), balise(corps, 'task-id'));
    const statut = statutDeFin(balise(corps, 'status'));
    if (tache && statut) cloreTache(tache, statut, le, balise(corps, 'output-file'));
  }
}

/** Un `task_status` du transcript (attachement) : même règle de fin que la notification. */
export function appliquerEtatAttachement(etat: EtatTranscript, piece: Objet, le: string): void {
  const tache = trouverTache(etat, null, texte(piece['taskId']));
  const statut = statutDeFin(texte(piece['status']));
  if (tache && statut) cloreTache(tache, statut, le, texte(piece['outputFilePath']));
}

export function arreterTache(etat: EtatTranscript, tacheId: string | null, le: string): void {
  const tache = trouverTache(etat, null, tacheId);
  if (tache) cloreTache(tache, 'arretee', le, null);
}

function balise(corps: string, nom: string): string | null {
  const m = new RegExp(`<${nom}>([\\s\\S]*?)</${nom}>`).exec(corps);
  const valeur = m?.[1]?.trim() ?? '';
  return valeur === '' ? null : valeur;
}

/** Agent relancé par SendMessage (`to` = son identifiant) : il retravaille, sa fin précédente ne compte plus. */
export function reprendreTache(etat: EtatTranscript, tacheId: string | null): void {
  const tache = trouverTache(etat, null, tacheId);
  if (!tache || tache.genre !== 'agent') return;
  tache.statut = 'en_cours';
  tache.finLe = null;
  tache.notifiee = false;
  tache.reprise = true;
}
