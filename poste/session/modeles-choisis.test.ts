// Responsabilité : tests du modèle choisi par Remote Control sur une conversation tenue ailleurs (Desktop,
// terminal) : persisté par le poste, survivant à son redémarrage, source datée de la fiche, et rendu tout de suite
// à la fiche de poste de la conversation.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigPoste } from '../config.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { BalayageSessions } from './balayage-sessions.ts';
import type { EtatTranscript } from './etat-transcript.ts';
import { journal, nouvelleSession } from './faux-sdk.ts';
import { ModelesChoisis } from './modeles-choisis.ts';
import { MarquesRecalage } from './recalage-demarrage.ts';
import { recalerFiche } from './recalage-fiche.ts';
import { SessionsSupprimees } from './suppression.ts';

const CONV = 'c0000000-0000-4000-8000-0000000000aa';
const RECENT = '2026-11-21T10:00:00.000Z';
const ANCIEN = '2026-11-20T08:00:00.000Z';
const CONFIG = { machine: 'poste-test', donnees: 'donnees-test' } as unknown as ConfigPoste; // jamais lu ici

let dossier: string;
let fichier: string;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'quart-modeles-choisis-'));
  fichier = join(dossier, 'modeles-choisis.json');
});

afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

const fiche = (): ResumeSession => ({
  id: CONV,
  machine: 'tour',
  projet: { machine: 'tour', chemin: '/p', nom: 'p' },
  cwd: '/p',
  titre: 't',
  objectif: null,
  modele: 'claude-fable-5-2',
  compte: 'principal',
  autonomie: false,
  statut: 'attente',
  contexte: { tokens: 0, max: 200_000 },
  etapes: 0,
  compactions: 0,
  claudeSessionId: CONV,
  tmux: null,
  attachee: false,
  pilotee: false,
  creeLe: '2026-11-01T09:00:00.000Z',
  majLe: RECENT,
});

const etatAncien: EtatTranscript = {
  majLe: ANCIEN,
  modele: 'claude-fable-5-2',
  modeleLe: ANCIEN,
  mode: null,
  contexte: null,
  travailDernier: false,
  ecritLe: 0,
};

describe('persistance du choix par le poste', () => {
  test('un choix persisté survit à la reconstruction du poste (même fichier, nouvel objet)', () => {
    new ModelesChoisis(fichier, journal).ecrire(CONV, { modele: 'claude-opus-5-5', le: RECENT });
    const reconstruit = new ModelesChoisis(fichier, journal);
    expect(reconstruit.pour(CONV)).toEqual({ modele: 'claude-opus-5-5', le: RECENT });
  });

  test('un choix plus ancien que celui déjà gardé ne le remplace pas', () => {
    const choisis = new ModelesChoisis(fichier, journal);
    choisis.ecrire(CONV, { modele: 'claude-opus-5-5', le: RECENT });
    choisis.ecrire(CONV, { modele: 'claude-sonnet-5-5', le: ANCIEN });
    expect(choisis.pour(CONV)).toEqual({ modele: 'claude-opus-5-5', le: RECENT });
  });

  test('un fichier illisible ne fait pas échouer le poste : rien de chargé', () => {
    writeFileSync(fichier, '{pas du json');
    expect(new ModelesChoisis(fichier, journal).pour(CONV)).toBeNull();
  });
});

describe('le choix comme source datée de la fiche', () => {
  test('un réglage sur la conversation puis un recalcul de la fiche donnent le nouveau modèle', () => {
    const choisis = new ModelesChoisis(fichier, journal);
    choisis.ecrire(CONV, { modele: 'claude-opus-5-5', le: RECENT });
    const r = recalerFiche(fiche(), { etat: etatAncien, desktop: null, choisi: choisis.pour(CONV) });
    expect(r).toMatchObject({ modele: 'claude-opus-5-5', modeleLe: RECENT });
  });

  test('un transcript plus récent que le choix l’emporte', () => {
    const choisis = new ModelesChoisis(fichier, journal);
    choisis.ecrire(CONV, { modele: 'claude-opus-5-5', le: ANCIEN });
    const recent: EtatTranscript = { ...etatAncien, modele: 'claude-sonnet-5-5', modeleLe: RECENT };
    const r = recalerFiche(fiche(), { etat: recent, desktop: null, choisi: choisis.pour(CONV) });
    expect(r.modele).toBe('claude-sonnet-5-5');
  });
});

describe('le balayage rend le choix à la fiche de poste de la conversation', () => {
  test('la session tenue ailleurs affiche le modèle choisi tout de suite, sans attendre le transcript', () => {
    const { session } = nouvelleSession(async () => [], {
      configDir: dossier,
      resume: { terminal: true, claudeSessionId: CONV, cwd: '/p', modele: 'claude-fable-5-2' },
    });
    session.rattacherTerminal(true, false, null); // tenue ailleurs : le balayage la marque ainsi
    const choisis = new ModelesChoisis(fichier, journal);
    const balayage = new BalayageSessions({
      config: CONFIG,
      journal,
      sessions: new Map([[session.resume.id, session]]),
      supprimees: new SessionsSupprimees(join(dossier, 'supprimees')),
      fichePour: () => undefined,
      creer: () => {
        throw new Error('creer non attendu dans ce test');
      },
      modeles: choisis,
      marques: new MarquesRecalage(null, journal),
      racineDesktop: dossier,
    });
    choisis.ecrire(CONV, { modele: 'claude-opus-5-5', le: RECENT });
    balayage.recalerConversation(CONV);
    expect(session.resume.modele).toBe('claude-opus-5-5');
    expect(session.resume.modeleLe).toBe(RECENT);
  });
});
