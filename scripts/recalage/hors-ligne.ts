#!/usr/bin/env bun
// Responsabilité : rejouer le recalage du démarrage HORS LIGNE sur une COPIE de la base du relais, avec le vrai code
// du poste (fiches recalées, découvertes, relecture complète des fils) et du relais (bonjour, recalage, historique,
// fantômes, jumelles). Les transcripts et fiches Desktop sont lus en lecture seule (machine locale, ou miroir d'une
// autre machine) ; rien n'est écrit ailleurs que dans la copie et le dossier de travail.
//
//   bun scripts/recalage/hors-ligne.ts --base <copie relais.db> --travail <dossier>
//     --poste 'tour|<home>|<sessions.json>' [--poste 'portable|<home miroir>|<sessions.json>']
//     [--vivantes <json { machine: [conversation…] }>]   processus Claude hors Lanterne (Desktop, terminal)
//     [--pilotees <json { machine: [conversation…] }>]   requêtes SDK vivantes de Lanterne (jamais touchées)
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import { type MessagePoste, TAILLE_LOT_HISTORIQUE } from '../../commun/protocole-poste.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { Diffusion } from '../../relais/clients/diffusion.ts';
import { type DonneesPoste, Postes } from '../../relais/parc/postes.ts';
import { ouvrirBase } from '../../relais/registre/base.ts';
import { Registre } from '../../relais/registre/registre.ts';
import { ArchivagesDesktop } from '../../relais/registre/archivages-desktop.ts';
import { DesktopDesPostes } from '../../relais/parc/desktop-postes.ts';
import { IndexDecouvertes, identifiantsTranscripts } from '../../poste/session/decouverte.ts';
import { etatDuTranscript, tourEnCours } from '../../poste/session/etat-transcript.ts';
import { fichesDesktop, fichesDesktopAnnoncees } from '../../poste/session/fiche-desktop.ts';
import { type EvenementHorodate, identifiantImage } from '../../poste/session/historique.ts';
import { PersistanceSessions, type SessionPersistee } from '../../poste/session/persistance.ts';
import {
  MarquesRecalage,
  RecalageFils,
  recalerAuChargement,
  statutExterne,
  transcriptDe,
} from '../../poste/session/recalage-demarrage.ts';
import { titreRelu } from '../../poste/session/recalage-fiche.ts';

const journal = pino({ level: process.env['NIVEAU'] ?? 'warn' });

interface Poste {
  readonly id: string;
  readonly home: string;
  readonly sessions: string;
}

type ParMachine = Record<string, string[]>;

// Fichier écrit par l'appelant : { machine: [conversation…] }.
const lireListe = (f: string | undefined): ParMachine => (f ? (JSON.parse(readFileSync(f, 'utf8')) as ParMachine) : {});

function options(): { base: string; travail: string; postes: Poste[]; vivantes: ParMachine; pilotees: ParMachine } {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      travail: { type: 'string' },
      poste: { type: 'string', multiple: true },
      vivantes: { type: 'string' },
      pilotees: { type: 'string' },
    },
  });
  if (!values.base || !values.travail || !values.poste) throw new Error('--base, --travail et --poste requis');
  const postes = values.poste.map((p): Poste => {
    const [id = '', home = '', sessions = ''] = p.split('|');
    return { id, home, sessions };
  });
  const listes = { vivantes: lireListe(values.vivantes), pilotees: lireListe(values.pilotees) };
  return { base: values.base, travail: values.travail, postes, ...listes };
}

// Le relais n'écrit au poste que des commandes : la prise factice retient les adoptions demandées (fiches orphelines).
function prise(machine: string, adoptions: string[]): ServerWebSocket<DonneesPoste> {
  const send = (brut: string): number => {
    const c = JSON.parse(brut) as { kind?: string; sessionId?: string }; // commande du relais, forme CommandeRelais
    if (c.kind === 'adopter' && c.sessionId) adoptions.push(c.sessionId);
    return 0;
  };
  const factice = { data: { machine }, send, close: () => undefined };
  return factice as unknown as ServerWebSocket<DonneesPoste>; // seuls data, send et close sont utilisés par Postes
}

const racineDesktop = (p: Poste): string => join(p.home, '.config', 'Claude', 'claude-code-sessions');

/** Les fiches du poste telles qu'il les annonce au démarrage : recalées, statut selon les processus hors Lanterne.
 *  Une session pilotée par Lanterne (requête SDK vivante) reste telle quelle. */
function fichesAuDemarrage(p: Poste, vivantes: ReadonlySet<string>, pilotees: ReadonlySet<string>): Fiche[] {
  const persistees = new PersistanceSessions(p.sessions.replace(/\/sessions\.json$/, '')).charger();
  return persistees.map((brute) => {
    const enLocal = { ...brute, configDir: brute.configDir ?? join(p.home, '.claude') };
    if (pilotees.has(enLocal.resume.claudeSessionId ?? enLocal.resume.id)) {
      // Requête Lanterne vivante : au démarrage du poste elle serait reprise ; seule sa fiche est recalée (en attente).
      const ctx = { journal, racineDesktop: racineDesktop(p) };
      return { persistee: recalerAuChargement(enLocal, new MarquesRecalage(null, journal), ctx), vivante: true };
    }
    return { persistee: ficheDemarree(p, enLocal, vivantes), vivante: false };
  });
}

interface Fiche {
  readonly persistee: SessionPersistee;
  readonly vivante: boolean;
}

function ficheDemarree(p: Poste, enLocal: SessionPersistee, vivantes: ReadonlySet<string>): SessionPersistee {
  const ctx = { journal, racineDesktop: racineDesktop(p) };
  const q = recalerAuChargement(titreRelu(enLocal, journal), new MarquesRecalage(null, journal), ctx);
  const conversation = q.resume.claudeSessionId ?? q.resume.id;
  const statut = q.aReprendre ? q.resume.statut : 'fermee'; // SessionSdk : rien ne vit au démarrage
  const vivante = vivantes.has(conversation);
  const etat = vivante ? etatDuTranscript(transcriptDe(q), journal) : null;
  const externe = statutExterne(statut, vivante, etat !== null && tourEnCours(etat, Date.now()));
  return { ...q, resume: { ...q.resume, statut: externe, terminal: vivante } };
}

function decouvertes(p: Poste, travail: string, connues: ReadonlySet<string>, vivantes: ReadonlySet<string>) {
  const racine = join(p.home, '.config', 'Claude', 'claude-code-sessions');
  const index = new IndexDecouvertes({
    machine: p.id,
    configDirs: () => [join(p.home, '.claude')],
    fichierCache: join(travail, `decouvertes-${p.id}.json`),
    journal,
    surChangement: () => undefined,
    fichesDesktop: () => fichesDesktop(racine, journal),
  });
  index.rafraichir();
  return index
    .liste((id) => connues.has(id))
    .map(({ chemin: _c, configDir: _d, ...d }) => ({
      ...d,
      ...(vivantes.has(d.id) ? { vivante: true } : {}),
    }));
}

function envoyerHistorique(recu: (m: MessagePoste) => void, sessionId: string, evts: readonly EvenementHorodate[]) {
  const replay = randomUUID();
  for (let i = 0; i < evts.length; i += TAILLE_LOT_HISTORIQUE) {
    recu({ kind: 'historique', sessionId, replay, evenements: evts.slice(i, i + TAILLE_LOT_HISTORIQUE) });
  }
}

interface PosteSimule {
  readonly poste: Poste;
  readonly fiches: Fiche[];
  readonly recu: (m: MessagePoste) => void;
  readonly adoptions: string[];
}

/** Le bonjour du poste, avec ses fiches recalées, ses découvertes, ses transcripts et ses fiches Desktop. */
function bonjour(
  p: Poste,
  o: ReturnType<typeof options>,
  fiches: readonly Fiche[],
  distantes: readonly ResumeSession[],
) {
  const vivantes = new Set(o.vivantes[p.id] ?? []);
  const connues = new Set(fiches.flatMap(({ persistee: f }) => [f.resume.id, f.resume.claudeSessionId ?? f.resume.id]));
  return {
    kind: 'bonjour' as const,
    version: 'recalage-hors-ligne',
    description: p.id,
    racines: [],
    projets: [],
    comptes: [],
    sessions: [...fiches.map((f) => f.persistee.resume), ...distantes.filter((s) => s.machine === p.id)],
    decouvertes: decouvertes(p, o.travail, connues, vivantes),
    transcripts: identifiantsTranscripts([join(p.home, '.claude')]),
    desktop: fichesDesktopAnnoncees(racineDesktop(p), journal),
  };
}

/** Adoption d'une fiche orpheline demandée par le relais : le poste la prend (fiche recalée), comme `hydrater`. */
function adopter(s: PosteSimule, registre: Registre, o: ReturnType<typeof options>): void {
  const vivantes = new Set(o.vivantes[s.poste.id] ?? []);
  for (const id of s.adoptions.splice(0)) {
    const resume = registre.session(id);
    if (!resume) continue;
    const brute = { resume, consignes: null, configDir: null, transcript: null, position: 0, aReprendre: false };
    const persistee = ficheDemarree(s.poste, { ...brute, configDir: join(s.poste.home, '.claude') }, vivantes);
    s.recu({ kind: 'session', session: persistee.resume });
    s.fiches.push({ persistee, vivante: false });
  }
}

function principal(): void {
  const o = options();
  if (!existsSync(o.base)) throw new Error(`copie introuvable : ${o.base}`);
  const db = ouvrirBase(o.base);
  const registre = new Registre(db, journal);
  const postes = new Postes(registre, new Diffusion(), new Map(), journal);
  postes.desktop = new DesktopDesPostes(new ArchivagesDesktop(db));
  const distantes = registre.sessions(true).filter((s) => s.id.startsWith('cse_'));
  const simules: PosteSimule[] = o.postes.map((poste) => {
    const adoptions: string[] = [];
    const ws = prise(poste.id, adoptions);
    postes.ouvert(ws);
    const recu = (m: MessagePoste): void => postes.recu(ws, JSON.stringify(m));
    const fiches = fichesAuDemarrage(poste, new Set(o.vivantes[poste.id] ?? []), new Set(o.pilotees[poste.id] ?? []));
    return { poste, fiches, recu, adoptions };
  });
  for (const s of simules) s.recu(bonjour(s.poste, o, s.fiches, distantes));
  // Une fois tous les postes annoncés : fantômes décidés, fiches Desktop connues de tous ; le spectateur republie
  // ses sessions Remote Control ; les orphelines sont adoptées.
  for (const s of simules) s.recu(bonjour(s.poste, o, s.fiches, distantes));
  for (const s of simules) adopter(s, registre, o);
  for (const s of simules)
    for (const d of distantes.filter((x) => x.machine === s.poste.id)) {
      s.recu({ kind: 'session', session: d });
    }
  let total = 0;
  for (const s of simules) total += recalerFils(s.poste, s.fiches, s.recu);
  db.close();
  process.stdout.write(`fils recalés : ${total}\n`);
}

function recalerFils(p: Poste, fiches: readonly Fiche[], recu: (m: MessagePoste) => void): number {
  const recalage = new RecalageFils({
    journal,
    racineDesktop: racineDesktop(p),
    marques: new MarquesRecalage(null, journal),
    relaisOuvert: () => true,
    fiches: () => fiches,
    // Image identifiée par son contenu, comme le stockeur du poste, sans rien écrire.
    stockeur: () => (image, rang, origine) => {
      const octets = Buffer.from(image.base64, 'base64');
      const nom = `image-${rang + 1}.${image.mime.split('/')[1] ?? 'png'}`;
      return {
        type: 'image',
        fichier: identifiantImage(octets),
        nom,
        mime: image.mime,
        taille: octets.length,
        origine,
      };
    },
    recalage: (sessionId, archiver, lignes) =>
      recu({
        kind: 'recalage',
        sessionId,
        archiver,
        ...(lignes ? { lignes: [...lignes.cles], messages: [...lignes.messages], jusqua: lignes.jusqua } : {}),
      }),
    historique: (sessionId, evts) => envoyerHistorique(recu, sessionId, evts),
  });
  let n = 0;
  while (recalage.pas()) n++;
  return n;
}

try {
  principal();
  process.exit(0); // les veilles de fichiers de l’index des découvertes ne retiennent pas le script
} catch (erreur) {
  process.stderr.write(
    `recalage hors ligne impossible : ${erreur instanceof Error ? erreur.message : String(erreur)}\n`,
  );
  process.exit(2);
}
