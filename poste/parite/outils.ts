// Responsabilité : les appels d'outils du transcript — résultats envoyés ou créés (SendUserFile, Write), tâches en
// arrière-plan (Agent, Bash), arrêts (TaskStop), et les chemins récents qui désignent le dépôt de travail.
import type { AppelEnAttente, EtatTranscript, TacheVue } from './etat.ts';
import { MAX_PROMPT } from '../../commun/parite.ts';
import { arreterTache, lierIdentifiant, type NouvelleTache, ouvrirTache, reprendreTache } from './taches.ts';
import { blocs, estObjet, nombre, texte, type Objet } from './lignes.ts';

const MAX_INDICES = 80;
const OUTILS_FICHIER = ['Edit', 'Write', 'Read', 'NotebookEdit'];
const DOSSIER_GIT = /(?:git\s+-C|\bcd)\s+(['"]?)(\/[^'"\s;&|()]+)\1/g;

/** Chemins absolus désignés par un appel d'outil (fichier édité ou lu, dossier de `git -C` ou de `cd`). */
export function indicesDeOutil(nom: string, entree: Objet): string[] {
  if (OUTILS_FICHIER.includes(nom)) {
    const fichier = texte(entree['file_path']) ?? texte(entree['notebook_path']);
    return fichier?.startsWith('/') ? [fichier] : [];
  }
  const commande = nom === 'Bash' ? texte(entree['command']) : null;
  if (commande === null) return [];
  return [...commande.matchAll(DOSSIER_GIT)].map((m) => m[2] ?? '').filter((c) => c !== '');
}

export function appliquerAppelOutil(etat: EtatTranscript, bloc: Objet, le: string, principal: boolean): void {
  const id = texte(bloc['id']);
  const nom = texte(bloc['name']);
  const entree = estObjet(bloc['input']) ? bloc['input'] : {};
  if (id === null || nom === null) return;
  if (principal) pousserIndices(etat, indicesDeOutil(nom, entree));
  switch (nom) {
    case 'SendUserFile':
      for (const f of tableauTextes(entree['files'])) enregistrerResultat(etat, f, 'envoye', le);
      return;
    case 'Write': {
      const fichier = texte(entree['file_path']);
      if (fichier !== null) enregistrerResultat(etat, fichier, 'cree', le);
      return;
    }
    case 'Agent':
    case 'Task':
      return ouvrirAgent(etat, id, entree, le);
    case 'Bash':
      return ouvrirCommande(etat, id, entree, le);
    case 'Monitor':
      return ouvrirMoniteur(etat, id, entree, le);
    case 'TaskStop':
      return arreterTache(etat, texte(entree['task_id']), le);
    case 'SendMessage':
      return reprendreTache(etat, texte(entree['to']), le);
    default:
      return;
  }
}

/** Résultat d'un appel : un Agent devient asynchrone, un Bash en arrière-plan reçoit son identifiant d'exécution. */
export function appliquerResultatOutil(etat: EtatTranscript, bloc: Objet, resultat: unknown, le: string): void {
  const id = texte(bloc['tool_use_id']);
  if (id === null) return;
  const detail = estObjet(resultat) ? resultat : {};
  const attente = etat.attentes.get(id);
  etat.attentes.delete(id);
  if (attente && (detail['isAsync'] === true || detail['status'] === 'async_launched')) {
    ouvrirAgentAsync(etat, id, attente, detail);
  }
  const tache = etat.taches.get(id);
  if (!tache) return;
  if (tache.premierPlan && !finAuPremierPlan(etat, tache, detail)) return;
  const identifiant = texte(detail['agentId']) ?? texte(detail['backgroundTaskId']) ?? texte(detail['taskId']);
  if (identifiant !== null) lierIdentifiant(etat, tache, identifiant);
  const modele = texte(detail['resolvedModel']);
  if (modele !== null) tache.modele = modele;
  const sortie = cheminDeSortie(bloc['content']);
  if (sortie !== null) tache.sortie = sortie;
}

// Résultat d'une commande au premier plan : passée en fond (Claude Code la détache au bout de son délai) elle reste
// une tâche ; finie, elle est oubliée. Rend vrai si la tâche continue.
function finAuPremierPlan(etat: EtatTranscript, tache: TacheVue, detail: Objet): boolean {
  if (texte(detail['backgroundTaskId']) !== null) {
    tache.premierPlan = false;
    return true;
  }
  etat.taches.delete(tache.id);
  return false;
}

function ouvrirAgentAsync(etat: EtatTranscript, id: string, attente: AppelEnAttente, detail: Objet): void {
  const tache = ouvrirTache(etat, {
    id,
    genre: 'agent',
    description: texte(attente.entree['description']) ?? '',
    debutLe: attente.le,
    prompt: tronquer(texte(attente.entree['prompt'])),
    modele: texte(detail['resolvedModel']) ?? texte(attente.entree['model']),
  });
  const agentId = texte(detail['agentId']);
  if (agentId !== null) lierIdentifiant(etat, tache, agentId);
}

function ouvrirAgent(etat: EtatTranscript, id: string, entree: Objet, le: string): void {
  if (entree['run_in_background'] === true) {
    ouvrirTache(etat, {
      id,
      genre: 'agent',
      description: texte(entree['description']) ?? '',
      debutLe: le,
      prompt: tronquer(texte(entree['prompt'])),
      modele: texte(entree['model']),
    });
    return;
  }
  etat.attentes.set(id, { nom: 'Agent', entree, le });
}

// Commande de fond, ou au premier plan (montrée tant qu'elle tourne, comme Desktop : 23/11).
function ouvrirCommande(etat: EtatTranscript, id: string, entree: Objet, le: string): void {
  const commande = texte(entree['command']) ?? '';
  const nouvelle: NouvelleTache = {
    ...(entree['run_in_background'] === true ? {} : { premierPlan: true }),
    id,
    genre: 'commande',
    description: texte(entree['description']) ?? commande.slice(0, 80),
    debutLe: le,
    prompt: tronquer(commande),
    modele: null,
  };
  ouvrirTache(etat, nouvelle);
}

// Monitor : surveillance de fond, sans run_in_background ; ses événements ne la terminent pas, son arrêt oui (TaskStop)
// ou son échéance (timeout_ms).
function ouvrirMoniteur(etat: EtatTranscript, id: string, entree: Objet, le: string): void {
  const commande = texte(entree['command']) ?? '';
  const duree = nombre(entree['timeout_ms']);
  const debut = Date.parse(le);
  ouvrirTache(etat, {
    id,
    genre: 'commande',
    description: texte(entree['description']) ?? commande.slice(0, 80),
    debutLe: le,
    prompt: tronquer(commande),
    modele: null,
    echeance: duree > 0 && !Number.isNaN(debut) ? new Date(debut + duree).toISOString() : null,
  });
}

function enregistrerResultat(etat: EtatTranscript, chemin: string, origine: 'envoye' | 'cree', le: string): void {
  etat.resultats.delete(chemin);
  etat.resultats.set(chemin, { origine, le });
}

function pousserIndices(etat: EtatTranscript, indices: string[]): void {
  etat.indices.push(indices);
  if (etat.indices.length > MAX_INDICES) etat.indices.shift();
}

function tableauTextes(valeur: unknown): string[] {
  return Array.isArray(valeur) ? valeur.filter((v): v is string => typeof v === 'string') : [];
}

function tronquer(valeur: string | null): string | null {
  return valeur === null ? null : valeur.slice(0, MAX_PROMPT);
}

/** Chemin du fichier de sortie d'une commande en arrière-plan, cité dans son résultat. */
function cheminDeSortie(contenu: unknown): string | null {
  const textes = typeof contenu === 'string' ? [contenu] : blocs(contenu).map((b) => texte(b['text']) ?? '');
  for (const t of textes) {
    const m = /Output is being written to: (\S+?)\. /.exec(t);
    if (m?.[1]) return m[1];
  }
  return null;
}
