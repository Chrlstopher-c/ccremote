// Responsabilité : la fiche d'une session adoptée — lancée hors ccremote, dans tmux ou dans un terminal ordinaire —
// et le transcript qui lui correspond. Une session sans identifiant réel n'est pas adoptée : pas de faux id.
import type { LanceurSession, ResumeSession } from '../../commun/session.ts';
import type { EntreeCc } from './registre-cc.ts';
import type { ProcessusClaude } from './processus.ts';
import type { PaneTmux } from './tmux.ts';
import { cheminTranscript, retrouverTranscript } from './transcript.ts';
import { estNomParDefaut } from './titre-transcript.ts';

export interface Origine {
  readonly machine: string;
  readonly compte: string;
  readonly fenetre: number;
}

export interface Adoptee {
  readonly id: string;
  readonly transcript: { readonly id: string; readonly chemin: string } | null;
  readonly nom: string | null; // registre cc, puis nom natif de Claude
  readonly lanceur: LanceurSession | null;
}

function depuisProcessus(proc: ProcessusClaude, entree: EntreeCc | undefined): Adoptee {
  return {
    id: proc.sessionId,
    transcript: { id: proc.sessionId, chemin: cheminTranscript(proc.cwd, proc.sessionId, proc.configDir) },
    nom: entree?.nom ?? proc.nom,
    lanceur: entree?.lanceur ?? null,
  };
}

/** L'identité d'une session tmux : Claude a déclaré son processus, ou la fiche cc la nomme, sinon le transcript
 *  unique du dossier. Rien de sûr : null (la session n'est pas adoptée). */
export function identitePane(
  pane: PaneTmux,
  panes: readonly PaneTmux[],
  proc: ProcessusClaude | undefined,
  entree: EntreeCc | undefined,
): Adoptee | null {
  if (proc) return depuisProcessus(proc, entree);
  if (entree) {
    return {
      id: entree.id,
      transcript: { id: entree.id, chemin: cheminTranscript(entree.cwd, entree.id, null) },
      nom: entree.nom,
      lanceur: entree.lanceur,
    };
  }
  const voisins = panes.filter((p) => p.dossier === pane.dossier).length;
  const t = retrouverTranscript(pane.dossier, pane.titre, voisins, null);
  return t ? { id: t.id, transcript: t, nom: null, lanceur: null } : null;
}

export function identiteProcessus(proc: ProcessusClaude, entree: EntreeCc | undefined): Adoptee {
  return depuisProcessus(proc, entree);
}

/** Processus hors tmux à adopter : seulement ceux dont la conversation a déjà un transcript (sinon fantôme). */
export function processusAdoptables(
  procs: readonly ProcessusClaude[],
  transcriptExiste: (proc: ProcessusClaude) => boolean,
): ProcessusClaude[] {
  return procs.filter((p) => !p.enTmux && transcriptExiste(p));
}

/** Une session supprimée par Chris n'est jamais réadoptée, même si son processus ou son pane tourne encore. */
export function adoptionAutorisee(id: string, supprimees: { has(identifiant: string): boolean }): boolean {
  return !supprimees.has(id);
}

/** Titre de repli : le premier nom utile (ni vide, ni nom par défaut tmux ou dossier), sinon le dossier. */
export function titreDe(nom: string | null, titrePane: string | null, dossier: string): string {
  const utile = (titre: string | null): titre is string =>
    titre !== null && titre.trim() !== '' && !estNomParDefaut(titre, dossier);
  return [nom, titrePane].find(utile) ?? (dossier.split('/').at(-1) || 'Claude');
}

export function ficheAdoptee(
  o: Origine,
  a: Adoptee,
  dossier: string,
  titre: string,
  tmux: PaneTmux | null,
): ResumeSession {
  const maintenant = new Date().toISOString();
  return {
    id: a.id,
    machine: o.machine,
    projet: { machine: o.machine, chemin: dossier, nom: dossier.split('/').at(-1) ?? dossier },
    cwd: dossier,
    titre,
    objectif: null,
    modele: 'défaut',
    compte: o.compte,
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: o.fenetre },
    etapes: 0,
    compactions: 0,
    claudeSessionId: a.transcript?.id ?? null,
    tmux: tmux?.nom ?? null,
    attachee: tmux?.attachee ?? false,
    pilotee: false,
    terminal: tmux === null,
    ...(a.lanceur ? { lanceur: a.lanceur } : {}),
    creeLe: maintenant,
    majLe: maintenant,
  };
}

/** Fiche d'une session cc fermée : id et dossier connus, reprenable par `cc --resume`. */
export function ficheFermee(o: Origine, e: EntreeCc, titre: string): ResumeSession {
  const maintenant = new Date().toISOString();
  return {
    id: e.id,
    machine: o.machine,
    projet: { machine: o.machine, chemin: e.cwd, nom: e.cwd.split('/').at(-1) ?? e.cwd },
    cwd: e.cwd,
    titre,
    objectif: null,
    modele: 'défaut',
    compte: o.compte,
    autonomie: false,
    statut: 'fermee',
    contexte: { tokens: 0, max: o.fenetre },
    etapes: 0,
    compactions: 0,
    claudeSessionId: e.id,
    tmux: null,
    attachee: false,
    pilotee: false,
    lanceur: e.lanceur,
    creeLe: e.creeLe,
    majLe: maintenant,
  };
}
