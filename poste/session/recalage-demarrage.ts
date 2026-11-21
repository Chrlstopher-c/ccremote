// Responsabilité : le recalage des sessions déjà connues du poste, au démarrage (et rejouable) — les correctifs de
// cohérence n'agissent que sur les nouveaux événements ; ici, chaque fiche persistée est recalée sur son transcript et
// sa fiche Claude Desktop (activité, modèle, mode, contexte, titre, Remote Control), et son fil est relu en entier une
// fois vers le relais (trous comblés, doublons et notifications en bulle écartés côté relais). Borné : une marque par
// session (version du recalage + taille et date du transcript) ; rien n'est refait tant que le transcript n'a pas
// changé. Une session pilotée par Lanterne (reprise prévue, requête vivante) n'est jamais touchée.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { dossiersProjets } from './decouverte.ts';
import type { Logger } from 'pino';
import type { ResumeSession, StatutSession } from '../../commun/session.ts';
import { RACINE_DESKTOP_DEFAUT } from './fiche-desktop.ts';
import type { EvenementHorodate, StockerImage } from './historique.ts';
import { lireHistorique } from './historique.ts';
import { cleTranscript } from '../../commun/cle-transcript.ts';
import type { SessionPersistee } from './persistance.ts';
import { recalerFiche, sourcesDe } from './recalage-fiche.ts';
import { titreDuTranscript, titreGenereDuTranscript, titreProvisoire } from './titre-transcript.ts';
import { cheminTranscript } from './transcript.ts';

/** Version des règles de recalage : la monter refait le recalage de toutes les sessions une fois. */
export const VERSION_RECALAGE = 2;
const PAUSE_ENTRE_FILS_MS = 250;

/** Clé de la marque « fiche recalée sur ce transcript » (distincte de la marque du fil relu vers le relais). */
export function cleRecalageFiche(id: string): string {
  return `fiche:${id}`;
}

/** Marque d'un transcript pour le recalage ; null s'il n'existe pas. */
export function marqueRecalage(chemin: string): string | null {
  try {
    const etat = statSync(chemin);
    return `${VERSION_RECALAGE}:${etat.size}:${Math.trunc(etat.mtimeMs)}`;
  } catch {
    return null;
  }
}

// Transcript rangé ailleurs que sous son dossier (session déplacée, dossier renommé) : cherché une fois par
// conversation.
const trouves = new Map<string, string | null>();

function chercherTranscript(conversation: string, configDir: string | null): string | null {
  const cle = `${configDir ?? ''}\u0000${conversation}`;
  if (trouves.has(cle)) return trouves.get(cle) ?? null;
  const candidats = dossiersProjets([configDir]).flatMap((base) => {
    try {
      return readdirSync(base).map((d) => join(base, d, `${conversation}.jsonl`));
    } catch {
      return []; // dossier des projets illisible : rien de plus à chercher
    }
  });
  const existants = candidats.filter((c) => existsSync(c));
  // Une copie `ssh-` (miroir de Claude Desktop) seulement à défaut de l'original.
  const trouve = existants.find((c) => !c.includes(`${sep}ssh-`)) ?? existants[0] ?? null;
  trouves.set(cle, trouve);
  return trouve;
}

/** Chemin du transcript de la conversation d'une fiche persistée (sous son dossier, sinon cherché). */
export function transcriptDe(p: SessionPersistee): string {
  const conversation = p.resume.claudeSessionId ?? p.resume.id;
  const attendu = cheminTranscript(p.resume.cwd, conversation, p.configDir);
  return existsSync(attendu) ? attendu : (chercherTranscript(conversation, p.configDir) ?? attendu);
}

/** Une session pilotée par Lanterne coupée en plein tour (reprise prévue, statut autre qu'« en attente ») : jamais
 *  recalée. En attente, seule sa fiche l'est (titre, mode, modèle, contexte, activité), son statut reste. */
export function piloteeEnCours(p: SessionPersistee): boolean {
  return p.aReprendre && p.resume.statut !== 'attente';
}

/** Statut d'une session tenue (ou non) par un processus Claude hors Lanterne (Desktop, terminal). */
export function statutExterne(statut: StatutSession, vivante: boolean, enTour: boolean): StatutSession {
  if (vivante) return enTour ? 'travail' : 'attente';
  return statut === 'travail' || statut === 'attente' || statut === 'demarrage' ? 'fermee' : statut;
}

export interface ContexteRecalage {
  readonly journal: Logger;
  readonly racineDesktop?: string;
}

export interface FicheRecalee {
  readonly resume: ResumeSession;
  readonly archiveeDesktop: boolean; // archivée dans Claude Desktop : à ranger une fois côté relais
}

function titreRecale(resume: ResumeSession, chemin: string, titreDesktop: string | null, journal: Logger): string {
  if (titreDesktop) return titreDesktop;
  const genere = titreGenereDuTranscript(chemin, resume.cwd, journal);
  if (genere) return genere;
  if (!titreProvisoire(resume.titre, resume.cwd)) return resume.titre;
  return titreDuTranscript(chemin, resume.cwd, journal) ?? resume.titre;
}

/** La fiche recalée sur son transcript et sa fiche Desktop ; null si le transcript n'existe pas (rien à recaler). */
export function recalerResume(p: SessionPersistee, ctx: ContexteRecalage): FicheRecalee | null {
  const chemin = transcriptDe(p);
  if (marqueRecalage(chemin) === null) return null;
  const conversation = p.resume.claudeSessionId ?? p.resume.id;
  const sources = sourcesDe(chemin, conversation, ctx.journal, ctx.racineDesktop ?? RACINE_DESKTOP_DEFAUT);
  const fiche = recalerFiche(p.resume, sources);
  const desktop = sources.desktop;
  const remoteControl = desktop
    ? { remoteControl: { actif: desktop.remoteControl, url: p.resume.remoteControl?.url ?? null } }
    : {};
  const { archivee: _archivee, ...sansArchive } = fiche;
  return {
    resume: {
      ...sansArchive,
      titre: titreRecale(fiche, chemin, desktop?.titre ?? null, ctx.journal),
      ...remoteControl,
    },
    archiveeDesktop: desktop?.archivee === true,
  };
}

/** Marques de recalage par session, gardées dans un fichier du poste (`recalage.json`). */
export class MarquesRecalage {
  private readonly marques: Map<string, string>;

  constructor(
    private readonly fichier: string | null,
    private readonly journal: Logger,
  ) {
    this.marques = new Map(Object.entries(this.charger()));
  }

  lire(id: string): string | undefined {
    return this.marques.get(id);
  }

  ecrire(id: string, marque: string): void {
    this.marques.set(id, marque);
    if (this.fichier === null) return;
    try {
      mkdirSync(dirname(this.fichier), { recursive: true });
      writeFileSync(`${this.fichier}.tmp`, JSON.stringify(Object.fromEntries(this.marques)));
      renameSync(`${this.fichier}.tmp`, this.fichier);
    } catch (erreur) {
      this.journal.error({ err: erreur, fichier: this.fichier }, 'marques de recalage non écrites');
    }
  }

  private charger(): Record<string, string> {
    if (this.fichier === null) return {};
    try {
      const brut: unknown = JSON.parse(readFileSync(this.fichier, 'utf8'));
      if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return {};
      return Object.fromEntries(Object.entries(brut).filter((e): e is [string, string] => typeof e[1] === 'string'));
    } catch {
      return {}; // premier démarrage : tout est à recaler une fois
    }
  }
}

/** La fiche persistée recalée au chargement, si sa marque a changé ; sinon telle quelle. */
export function recalerAuChargement(
  p: SessionPersistee,
  marques: MarquesRecalage,
  ctx: ContexteRecalage,
): SessionPersistee {
  if (piloteeEnCours(p) || marques.lire(p.resume.id) === marqueRecalage(transcriptDe(p))) return p;
  const recalee = recalerResume(p, ctx);
  if (!recalee) return p;
  return { ...p, resume: p.aReprendre ? { ...recalee.resume, statut: p.resume.statut } : recalee.resume };
}

/** Clés des lignes du transcript relues (voir commun/cle-transcript.ts) et heure de la dernière. */
export interface LignesRelues {
  readonly cles: readonly string[];
  readonly messages: readonly string[]; // textes des messages de Chris
  // Une minute avant la dernière écriture d'un transcript qui bouge encore : rien de plus récent n'est jugé.
  readonly jusqua: string;
}

/** Lignes relues d'une conversation unique ; null pour une fiche qui en a tenu plusieurs (rembobinage du premier
 *  message) : son fil réunit plusieurs transcripts, rien n'y est étranger d'office. */
export function lignesRelues(
  p: SessionPersistee,
  evenements: readonly EvenementHorodate[],
  ecritLe: number,
): LignesRelues | null {
  const autres = (p.identifiants ?? []).filter((id) => id !== (p.resume.claudeSessionId ?? p.resume.id));
  if (autres.length > 0 || evenements.length === 0 || ecritLe <= 0) return null;
  const cles = evenements.flatMap((e) => cleTranscript(e.evt) ?? []);
  const messages = evenements.flatMap((e) => (e.evt.type === 'message' ? [e.evt.texte] : []));
  // Transcript au repos depuis 10 min : il est complet, toute ligne absente est étrangère quelle que soit son heure.
  const auRepos = Date.now() - ecritLe > 10 * 60_000;
  const jusqua = auRepos ? JUSQU_A_LA_FIN : new Date(ecritLe - 60_000).toISOString();
  return { cles: [...new Set(cles)], messages: [...new Set(messages)], jusqua };
}

const JUSQU_A_LA_FIN = '9999-12-31T23:59:59.999Z';

function ecritLe(chemin: string): number {
  try {
    return statSync(chemin).mtimeMs;
  } catch {
    return 0;
  }
}

export interface DependancesRecalageFils {
  readonly journal: Logger;
  readonly racineDesktop?: string;
  /** Les fiches du poste (persistées) et si leur requête Lanterne est vivante. */
  readonly fiches: () => readonly { readonly persistee: SessionPersistee; readonly vivante: boolean }[];
  readonly stockeur: (sessionId: string) => StockerImage | undefined;
  /** La fiche recalée, appliquée à la session du poste (persistée, annoncée). */
  readonly appliquer: (sessionId: string, recalee: ResumeSession) => void;
  /** Annonce au relais : fil à recaler (nettoyage, archivage Desktop), puis la relecture complète. */
  readonly recalage: (sessionId: string, archiver: boolean, lignes: LignesRelues | null) => void;
  readonly historique: (sessionId: string, evenements: readonly EvenementHorodate[]) => void;
  /** La marque est posée après l'envoi. */
  readonly marques: MarquesRecalage;
  readonly relaisOuvert: () => boolean;
  readonly pauseMs?: number;
}

/** File des fils à relire en entier, une session à la fois, seulement quand le lien au relais est ouvert. */
export class RecalageFils {
  private enCours = false;

  constructor(private readonly d: DependancesRecalageFils) {}

  /** Lance (ou relance après une reconnexion) le recalage des fils dont la marque a changé. */
  lancer(): void {
    if (this.enCours) return;
    this.enCours = true;
    setTimeout(() => this.suivant(), this.d.pauseMs ?? PAUSE_ENTRE_FILS_MS);
  }

  /** Un pas : la prochaine session à recaler ; vrai s'il en reste. Exposé pour un recalage hors ligne. */
  pas(): boolean {
    const a = this.prochaine();
    if (!a) return false;
    this.recalerUne(a.persistee, a.marque);
    return true;
  }

  private suivant(): void {
    if (!this.d.relaisOuvert() || !this.pas()) {
      this.enCours = false;
      return;
    }
    setTimeout(() => this.suivant(), this.d.pauseMs ?? PAUSE_ENTRE_FILS_MS);
  }

  private prochaine(): { persistee: SessionPersistee; marque: string } | null {
    for (const f of this.d.fiches()) {
      if (f.vivante || f.persistee.aReprendre) continue; // fil d'une session pilotée : il vient du direct
      const marque = marqueRecalage(transcriptDe(f.persistee));
      if (marque !== null && marque !== this.d.marques.lire(f.persistee.resume.id))
        return { persistee: f.persistee, marque };
    }
    return null;
  }

  private recalerUne(p: SessionPersistee, marque: string): void {
    const id = p.resume.id;
    const chemin = transcriptDe(p);
    try {
      const recalee = recalerResume(p, this.d);
      if (recalee) this.d.appliquer(id, recalee.resume);
      const ecrit = ecritLe(chemin);
      const evenements = lireHistorique(chemin, this.d.journal, this.d.stockeur(id));
      this.d.recalage(id, recalee?.archiveeDesktop === true, lignesRelues(p, evenements, ecrit));
      if (evenements.length > 0) this.d.historique(id, evenements);
      this.d.journal.info({ session: id, evenements: evenements.length }, 'fil recalé sur le transcript');
    } catch (erreur) {
      this.d.journal.error({ err: erreur, session: id }, 'recalage du fil impossible : marqué pour ne pas boucler');
    }
    this.d.marques.ecrire(id, marque);
  }
}
