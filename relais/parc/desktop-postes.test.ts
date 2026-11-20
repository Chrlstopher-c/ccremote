// Responsabilité : tests des fiches Claude Desktop annoncées par les postes — Remote Control reporté sur la fiche de la
// conversation, archivage rangé une seule fois (mémoire et base), et par le relais (message `decouvertes`).
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { FicheDesktopAnnoncee } from '../../commun/decouverte.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ArchivagesDesktop, ArchivagesEnMemoire } from '../registre/archivages-desktop.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { DesktopDesPostes } from './desktop-postes.ts';
import { type DonneesPoste, Postes } from './postes.ts';

const journal = pino({ enabled: false });
const MAJ = '2026-11-18T10:00:00.000Z';

function session(id: string, extra: Partial<ResumeSession> = {}): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: id,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'fermee',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: id,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
    ...extra,
  };
}

function fiche(conversation: string, extra: Partial<FicheDesktopAnnoncee> = {}): FicheDesktopAnnoncee {
  return { conversation, archivee: false, remoteControl: false, hote: null, ...extra };
}

describe('DesktopDesPostes.avecDesktop', () => {
  test('l’interrupteur Remote Control vient de la fiche, l’URL déjà connue est gardée', () => {
    const d = new DesktopDesPostes(new ArchivagesEnMemoire());
    d.recevoir('tour', [fiche('s', { remoteControl: true })]);
    const r = d.avecDesktop(session('s', { remoteControl: { actif: false, url: 'https://claude.ai/code/s' } }));
    expect(r.remoteControl).toEqual({ actif: true, url: 'https://claude.ai/code/s' });
  });

  test('une session distante (suivie depuis un compte) reste telle quelle, même avec une fiche Desktop', () => {
    const d = new DesktopDesPostes(new ArchivagesEnMemoire());
    d.recevoir('tour', [fiche('cse_s', { remoteControl: true })]);
    const distante = session('cse_s', {
      distant: { compte: 'principal', idDistant: 'cse_s', connexion: 'connectee', probleme: null },
    });
    expect(d.avecDesktop(distante)).toBe(distante);
  });

  test('sans fiche Desktop pour la conversation, la session reste telle quelle', () => {
    const d = new DesktopDesPostes(new ArchivagesEnMemoire());
    const s = session('s');
    expect(d.avecDesktop(s)).toBe(s);
  });
});

describe('DesktopDesPostes — archivage rangé une seule fois', () => {
  test('aArchiver est vrai une fois ; archivee() le retient, et il ne l’est plus', () => {
    const d = new DesktopDesPostes(new ArchivagesEnMemoire());
    d.recevoir('tour', [fiche('c1', { archivee: true })]);
    expect(d.aArchiver('c1')).toBe(true);
    d.archivee('c1');
    expect(d.aArchiver('c1')).toBe(false);
    expect(d.dejaArchivee('c1')).toBe(true);
  });

  test('une fiche archivée mais dont Remote Control est actif n’est pas rangée d’office', () => {
    const d = new DesktopDesPostes(new ArchivagesEnMemoire());
    d.recevoir('tour', [fiche('c1', { archivee: true, remoteControl: true })]);
    expect(d.aArchiver('c1')).toBe(false);
  });
});

describe('ArchivagesDesktop', () => {
  test('un archivage retenu en base est connu d’une autre instance sur la même base', () => {
    const db = ouvrirBase(':memory:');
    try {
      new ArchivagesDesktop(db).retenir('c1');
      expect(new ArchivagesDesktop(db).deja('c1')).toBe(true);
      expect(new ArchivagesDesktop(db).deja('autre')).toBe(false);
    } finally {
      db.close();
    }
  });

  test('l’archivage survit à la fermeture et à la réouverture du fichier de base', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'archivages-desktop-'));
    const chemin = join(dossier, 'relais.db');
    try {
      const premiere = ouvrirBase(chemin);
      new ArchivagesDesktop(premiere).retenir('c1');
      premiere.close();
      const seconde = ouvrirBase(chemin);
      try {
        expect(new ArchivagesDesktop(seconde).deja('c1')).toBe(true);
      } finally {
        seconde.close();
      }
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});

interface Montage {
  readonly postes: Postes;
  readonly registre: Registre;
  readonly poste: ServerWebSocket<DonneesPoste>;
}

function montage(): Montage {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  const diffusion = new Diffusion();
  diffusion.ajouter({ send: () => undefined } as unknown as ServerWebSocket<unknown>);
  const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
  const poste = {
    data: { machine: 'tour' },
    send: () => undefined,
    close: () => undefined,
  } as unknown as ServerWebSocket<DonneesPoste>;
  postes.ouvert(poste);
  return { postes, registre, poste };
}

// La fiche de la conversation est reçue telle qu'un poste la rend au relais.
function recevoirSession(m: Montage, s: ResumeSession): void {
  m.postes.recu(m.poste, JSON.stringify({ kind: 'session', session: s }));
}

// Le poste annonce ses fiches Claude Desktop (message `decouvertes`, sans découverte).
function annoncerDesktop(m: Montage, desktop: FicheDesktopAnnoncee[]): void {
  m.postes.recu(m.poste, JSON.stringify({ kind: 'decouvertes', decouvertes: [], desktop }));
}

describe('fiches Desktop annoncées au relais', () => {
  test('une conversation archivée dans Desktop est rangée une fois ; la remettre en liste ne la re-range pas', () => {
    const m = montage();
    recevoirSession(m, session('c1'));
    annoncerDesktop(m, [fiche('c1', { archivee: true })]);
    expect(m.registre.sessions(false).map((s) => s.id)).not.toContain('c1');
    expect(m.registre.session('c1')?.archivee).toBe(true);

    m.registre.definirArchivee('c1', false);
    annoncerDesktop(m, [fiche('c1', { archivee: true })]);
    expect(m.registre.session('c1')?.archivee).toBe(false);
    expect(m.registre.sessions(false).map((s) => s.id)).toContain('c1');
  });

  test('une fiche Desktop avec Remote Control actif porte l’interrupteur sur la session', () => {
    const m = montage();
    recevoirSession(m, session('c2'));
    annoncerDesktop(m, [fiche('c2', { remoteControl: true })]);
    expect(m.registre.session('c2')?.remoteControl?.actif).toBe(true);
  });

  test('une fiche archivée dont Remote Control est actif n’est pas rangée', () => {
    const m = montage();
    recevoirSession(m, session('c3'));
    annoncerDesktop(m, [fiche('c3', { archivee: true, remoteControl: true })]);
    expect(m.registre.session('c3')?.archivee).toBe(false);
  });
});
