// Responsabilité : Remote Control d'une session. Remote Control n'existe que dans le TUI : une session SDK y passe le
// temps de la connexion (resume puis `/remote-control`) et y revient à la déconnexion ; une session déjà au TUI reçoit
// la commande sur place. Une seule bascule à la fois par session.
import { existsSync, statSync } from 'node:fs';
import type { Logger } from 'pino';
import type { Moteur } from '../../commun/session.ts';
import { consignesAvecPresentation, consignesSansPresentation } from './consignes.ts';
import type { Reponse } from './gestionnaire.ts';
import type { SessionPersistee } from './persistance.ts';
import type { SessionPoste } from './session-poste.ts';
import { SessionSdk } from './session-sdk.ts';
import { SessionTmux } from './session-tmux.ts';
import { cheminTranscript } from './transcript.ts';

/** Ce que la bascule touche du gestionnaire : ses sessions, leur fabrication et leur sauvegarde. */
export interface GestionBascule {
  readonly sessions: Map<string, SessionPoste>;
  readonly config: { readonly machine: string };
  readonly journal: Logger;
  creer(p: SessionPersistee): SessionPoste;
  sauvegarder(): void;
}

const EN_COURS = new Set<string>(); // sessions dont le moteur change : aucune autre commande n'y passe

export function enBascule(id: string): boolean {
  return EN_COURS.has(id);
}

export async function basculerControle(g: GestionBascule, id: string, actif: boolean): Promise<Reponse> {
  const s = g.sessions.get(id);
  if (!s) return { ok: false, erreur: `session inconnue sur ${g.config.machine}` };
  if (EN_COURS.has(id)) return { ok: false, erreur: 'bascule Remote Control déjà en cours' };
  if (s.resume.terminal) return { ok: false, erreur: 'session ouverte dans un terminal : Remote Control impossible' };
  if ((s.resume.remoteControl?.actif ?? false) === actif) return { ok: true, donnees: s.resume };
  EN_COURS.add(id);
  try {
    const erreur = await basculer(g, s, actif);
    const courante = g.sessions.get(id) ?? s;
    return erreur ? { ok: false, erreur } : { ok: true, donnees: courante.resume };
  } finally {
    EN_COURS.delete(id);
  }
}

async function basculer(g: GestionBascule, s: SessionPoste, actif: boolean): Promise<string | null> {
  if (s instanceof SessionTmux) return basculerTui(g, s, actif);
  if (!actif) return null;
  if (s.resume.statut === 'travail' || s.resume.statut === 'compaction' || s.resume.dialogue)
    return 'session occupée : Remote Control se branche à la fin du tour';
  const fermeture = await s.fermer();
  if (fermeture) return fermeture;
  const tui = remplacer(g, s, 'tmux');
  if (!(tui instanceof SessionTmux)) return 'bascule vers le TUI impossible';
  const erreur = (await tui.reprendre(undefined, true)) ?? (await tui.basculerControle(true));
  if (!erreur) return null;
  const retour = await revenirSdk(g, tui);
  return retour ? `${erreur} (${retour})` : erreur;
}

async function basculerTui(g: GestionBascule, s: SessionTmux, actif: boolean): Promise<string | null> {
  const erreur = await s.basculerControle(actif);
  if (erreur || actif) return erreur;
  return (await s.quitterTui()) ?? revenirSdk(g, s);
}

// Retour au SDK : le TUI (s'il vit encore) s'arrête, puis la conversation reprend par resume.
async function revenirSdk(g: GestionBascule, s: SessionPoste): Promise<string | null> {
  const arret = await s.fermer();
  if (arret) g.journal.warn({ session: s.resume.id, erreur: arret }, 'arrêt du TUI au retour SDK en échec');
  const erreur = await remplacer(g, s, 'sdk').reprendre();
  return erreur ? `reprise SDK impossible : ${erreur}` : null;
}

// Même session, autre processus : le moteur change, l'identité et le transcript restent. Le TUI ne relit que les
// lignes écrites après la bascule (le SDK a déjà porté les précédentes dans le fil).
function remplacer(g: GestionBascule, ancienne: SessionPoste, moteur: Moteur): SessionPoste {
  const p = ancienne.persistee;
  const chemin = p.transcript ?? cheminTranscript(p.resume.cwd, p.resume.id, p.configDir);
  const sdk = moteur === 'sdk';
  const nouvelle = g.creer({
    ...p,
    resume: {
      ...p.resume,
      moteur,
      tmux: null,
      attachee: false,
      statut: sdk ? 'attente' : 'demarrage',
      remoteControl: sdk ? { actif: false, url: null } : null,
    },
    consignes:
      p.consignes === null ? null : sdk ? consignesAvecPresentation(p.consignes) : consignesSansPresentation(p.consignes),
    transcript: chemin,
    position: sdk ? p.position : tailleTranscript(chemin),
    aReprendre: false,
  });
  g.sessions.set(p.resume.id, nouvelle);
  g.sauvegarder();
  return nouvelle;
}

/** Sort proprement une session pilotée du TUI : Remote Control coupé d'abord, puis `/exit` (tmux arrêté au délai). */
export async function sortirTui(s: SessionTmux): Promise<string | null> {
  if (s.resume.remoteControl?.actif) {
    const erreur = await s.basculerControle(false);
    if (erreur) return erreur;
  }
  return s.quitterTui();
}

/** Rembobinage d'une session tmux : elle repasse au SDK (TUI quitté, Remote Control coupé), puis le SDK rembobine. */
export async function rembobinerTui(g: GestionBascule, s: SessionTmux, messageId: string): Promise<Reponse> {
  const id = s.resume.id;
  if (EN_COURS.has(id)) return { ok: false, erreur: 'bascule Remote Control en cours : réessayer' };
  if (s.resume.statut === 'travail' || s.resume.statut === 'compaction' || s.resume.dialogue)
    return { ok: false, erreur: 'session occupée : rembobinage impossible pendant un tour' };
  EN_COURS.add(id);
  try {
    const erreur = await sortirTui(s);
    if (erreur) return { ok: false, erreur };
    const sdk = remplacer(g, s, 'sdk');
    if (!(sdk instanceof SessionSdk)) return { ok: false, erreur: 'retour au SDK impossible' };
    const refus = await sdk.rembobiner(messageId);
    g.sauvegarder();
    return refus ? { ok: false, erreur: refus } : { ok: true, donnees: sdk.resume };
  } finally {
    EN_COURS.delete(id);
  }
}

function tailleTranscript(chemin: string): number {
  return existsSync(chemin) ? statSync(chemin).size : 0;
}
