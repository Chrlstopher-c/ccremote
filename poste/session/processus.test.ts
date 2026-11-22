// Responsabilité : tests de la lecture des déclarations de processus Claude — une déclaration tronquée ne bloque pas
// la découverte des autres sessions.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { processusClaude } from './processus.ts';

const journal = pino({ enabled: false });

function configAvec(fichiers: Record<string, string>): { dossier: string; nettoyer: () => void } {
  const dossier = mkdtempSync(join(tmpdir(), 'decl-claude-'));
  mkdirSync(join(dossier, 'sessions'));
  for (const [nom, contenu] of Object.entries(fichiers)) writeFileSync(join(dossier, 'sessions', nom), contenu);
  return { dossier, nettoyer: () => rmSync(dossier, { recursive: true, force: true }) };
}

describe('processusClaude : déclarations illisibles', () => {
  test('une déclaration tronquée est ignorée sans faire échouer la lecture', () => {
    const { dossier, nettoyer } = configAvec({ '999999.json': '{"pid": 999999, "sess' });
    try {
      expect(processusClaude([dossier], journal)).toEqual([]);
    } finally {
      nettoyer();
    }
  });
});

// Claude Desktop : son CLI tourne sous un nom de version, et sa déclaration porte l'heure de démarrage du processus.
const decl = (pid: number, procStart: string): string =>
  JSON.stringify({ pid, sessionId: `sess-${pid}`, cwd: '/home/x', kind: 'interactive', procStart });

describe('processusClaude : Claude Desktop reconnu vivant', () => {
  test('un CLI lancé sous un nom de version (2.1.325-…) est un processus Claude vivant', () => {
    const { dossier, nettoyer } = configAvec({ '2243.json': decl(2243, '2530') });
    try {
      const lecteur = (pid: number) =>
        pid === 2243
          ? {
              comm: '2.1.325-1ef04b3',
              exe: '/home/x/.claude/remote/ccd-cli/2.1.325-1ef04b3',
              demarrage: '2530',
              enTmux: false,
            }
          : null;
      expect(processusClaude([dossier], journal, lecteur).map((p) => p.sessionId)).toEqual(['sess-2243']);
    } finally {
      nettoyer();
    }
  });

  test('un pid recyclé (même nom, autre heure de démarrage) n est pas la session déclarée', () => {
    const { dossier, nettoyer } = configAvec({ '2243.json': decl(2243, '2530') });
    try {
      const lecteur = (): { comm: string; exe: string; demarrage: string; enTmux: boolean } => ({
        comm: 'claude', exe: '/usr/bin/claude', demarrage: '9999', enTmux: false,
      });
      expect(processusClaude([dossier], journal, lecteur)).toEqual([]);
    } finally {
      nettoyer();
    }
  });

  test('un processus qui n est pas Claude ne compte pas, même déclaré', () => {
    const { dossier, nettoyer } = configAvec({ '77.json': decl(77, '1') });
    try {
      const lecteur = (): { comm: string; exe: string; demarrage: string; enTmux: boolean } => ({
        comm: 'bash', exe: '/usr/bin/bash', demarrage: '1', enTmux: false,
      });
      expect(processusClaude([dossier], journal, lecteur)).toEqual([]);
    } finally {
      nettoyer();
    }
  });
});

const declSdk = (pid: number, sessionId: string, entrypoint: string): string =>
  JSON.stringify({ pid, sessionId, cwd: '/home/x', kind: 'interactive', entrypoint });

describe('processusClaude : processus SDK repérés', () => {
  test('un processus lancé par le SDK (sdk-ts) est marqué sdk ; Claude Desktop ne l’est pas', () => {
    const { dossier, nettoyer } = configAvec({
      '2243.json': declSdk(2243, 'sess-sdk', 'sdk-ts'),
      '2244.json': declSdk(2244, 'sess-desk', 'claude-desktop'),
    });
    try {
      const lecteur = (): { comm: string; exe: string; demarrage: string; enTmux: boolean } => ({
        comm: 'claude', exe: '/usr/bin/claude', demarrage: '1', enTmux: false,
      });
      const trouves = processusClaude([dossier], journal, lecteur);
      expect(trouves.find((p) => p.sessionId === 'sess-sdk')?.sdk).toBe(true);
      expect(trouves.find((p) => p.sessionId === 'sess-desk')?.sdk).toBe(false);
    } finally {
      nettoyer();
    }
  });
});

// `claude -p` (ou un SDK en mode impression) n'est pas une session interactive : jamais adoptée, jamais une
// conversation tenue ailleurs. La déclaration porte soit un `kind` non interactif, soit l'entrypoint `sdk-cli`.
const declNonInteractive = (pid: number, extra: Record<string, string>): string =>
  JSON.stringify({ pid, sessionId: `sess-${pid}`, cwd: '/home/x', ...extra });

const lecteurClaude = (): { comm: string; exe: string; demarrage: string; enTmux: boolean } => ({
  comm: 'claude', exe: '/usr/bin/claude', demarrage: '1', enTmux: false,
});

describe('processusClaude : processus non interactifs écartés', () => {
  test('un claude -p (entrypoint sdk-cli, sans kind) n est pas une session interactive', () => {
    const { dossier, nettoyer } = configAvec({ '3001.json': declNonInteractive(3001, { entrypoint: 'sdk-cli' }) });
    try {
      expect(processusClaude([dossier], journal, lecteurClaude)).toEqual([]);
    } finally {
      nettoyer();
    }
  });

  test('une déclaration de kind non interactif est écartée', () => {
    const { dossier, nettoyer } = configAvec({ '3002.json': declNonInteractive(3002, { kind: 'print' }) });
    try {
      expect(processusClaude([dossier], journal, lecteurClaude)).toEqual([]);
    } finally {
      nettoyer();
    }
  });

  test('une session interactive du terminal reste reconnue', () => {
    const { dossier, nettoyer } = configAvec({
      '3003.json': declNonInteractive(3003, { kind: 'interactive', entrypoint: 'cli' }),
    });
    try {
      expect(processusClaude([dossier], journal, lecteurClaude).map((p) => p.sessionId)).toEqual(['sess-3003']);
    } finally {
      nettoyer();
    }
  });
});
