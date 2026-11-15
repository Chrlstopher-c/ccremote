// Responsabilité : tests du faux shell de la démo (interpréteur pur et session de saisie), sans réseau ni processus.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { PROJET_DEMO } from './arbre-demo';
import { fabriqueTerminalDemo } from './terminal-demo';
import { executerCommande } from './shell-demo';
import type { SessionTerminal } from './terminal';

describe('executerCommande', () => {
  test('ls liste les entrées visibles du dossier courant, dossiers suffixés par /', () => {
    const { sortie } = executerCommande('ls', PROJET_DEMO);
    expect(sortie).toBe('docs/  package.json  README.md  src/  TODO.md');
    expect(sortie).not.toContain('.env.example');
  });

  test('ls d’un sous-dossier relatif', () => {
    expect(executerCommande('ls src/donnees', PROJET_DEMO).sortie).toBe('index.ts  monde-etat.ts');
  });

  test('pwd rend le dossier courant', () => {
    expect(executerCommande('pwd', PROJET_DEMO).sortie).toBe(PROJET_DEMO);
  });

  test('cd change le dossier courant, relatif ou absolu', () => {
    const relatif = executerCommande('cd src', PROJET_DEMO);
    expect(relatif.cwd).toBe(`${PROJET_DEMO}/src`);
    expect(executerCommande('cd /demo', PROJET_DEMO).cwd).toBe('/demo');
    expect(executerCommande('cd ..', `${PROJET_DEMO}/src`).cwd).toBe(PROJET_DEMO);
  });

  test('cd vers un dossier absent refuse et garde le dossier courant', () => {
    const r = executerCommande('cd inexistant', PROJET_DEMO);
    expect(r.cwd).toBe(PROJET_DEMO);
    expect(r.sortie).toBe('cd: inexistant: Aucun fichier ou dossier de ce type');
  });

  test('echo rend ses arguments', () => {
    expect(executerCommande('echo bonjour   le monde', PROJET_DEMO).sortie).toBe('bonjour le monde');
  });

  test('git status dans le projet rend une sortie de statut plausible', () => {
    const sortie = executerCommande('git status', PROJET_DEMO).sortie;
    expect(sortie).toContain('On branch nuit/2026-11-15');
    expect(sortie).toContain('modified:   src/donnees/monde-etat.ts');
  });

  test('git status hors du projet échoue comme un vrai dépôt absent', () => {
    expect(executerCommande('git status', '/demo').sortie).toContain('not a git repository');
  });

  test('une commande inconnue le dit', () => {
    expect(executerCommande('xyz --fou', PROJET_DEMO).sortie).toBe('xyz: commande introuvable');
  });

  test('clear demande d’effacer l’écran', () => {
    expect(executerCommande('clear', PROJET_DEMO).effacer).toBe(true);
  });

  test('une ligne vide ne fait rien', () => {
    expect(executerCommande('   ', PROJET_DEMO)).toEqual({ sortie: '', cwd: PROJET_DEMO, effacer: false });
  });
});

function sessionDemo(): { term: SessionTerminal; sortie: string[] } {
  const term = fabriqueTerminalDemo({
    machine: 'poste-a',
    cible: { type: 'shell', dossier: PROJET_DEMO },
    colonnes: 80,
    lignes: 24,
  });
  const sortie: string[] = [];
  term.surSortie((t) => sortie.push(t));
  return { term, sortie };
}

describe('session du terminal de démo', () => {
  test('annonce le poste et affiche l’invite dans le dossier de départ', () => {
    const { sortie } = sessionDemo();
    expect(sortie.join('')).toContain(`poste-a:${PROJET_DEMO}$ `);
  });

  test('une commande tapée est répétée, exécutée, puis suivie d’une nouvelle invite', () => {
    const { term, sortie } = sessionDemo();
    sortie.length = 0;
    term.ecrire('pwd\r');
    expect(sortie.join('')).toBe(`pwd\r\n${PROJET_DEMO}\r\nposte-a:${PROJET_DEMO}$ `);
  });

  test('le retour arrière corrige la ligne avant validation', () => {
    const { term, sortie } = sessionDemo();
    sortie.length = 0;
    term.ecrire('pwdx\u007f\r');
    expect(sortie.join('')).toContain(`${PROJET_DEMO}\r\n`);
    expect(sortie.join('')).toContain('\b \b');
  });

  test('Ctrl+C abandonne la ligne et rend une invite', () => {
    const { term, sortie } = sessionDemo();
    sortie.length = 0;
    term.ecrire('rm -rf\u0003');
    expect(sortie.join('')).toBe(`rm -rf^C\r\nposte-a:${PROJET_DEMO}$ `);
  });

  test('une séquence d’échappement (flèches) est ignorée', () => {
    const { term, sortie } = sessionDemo();
    sortie.length = 0;
    term.ecrire('\u001b[A');
    expect(sortie).toEqual([]);
  });

  test('cd puis pwd suit le dossier courant de la session', () => {
    const { term, sortie } = sessionDemo();
    term.ecrire('cd src\r');
    sortie.length = 0;
    term.ecrire('pwd\r');
    expect(sortie.join('')).toContain(`${PROJET_DEMO}/src\r\n`);
  });

  test('après fermeture, la saisie n’a plus d’effet', () => {
    const { term, sortie } = sessionDemo();
    term.fermer();
    sortie.length = 0;
    term.ecrire('pwd\r');
    expect(sortie).toEqual([]);
  });

  test('une cible tmux l’annonce', () => {
    const term = fabriqueTerminalDemo({
      machine: 'poste-b',
      cible: { type: 'tmux', tmux: 'claude-1' },
      colonnes: 80,
      lignes: 24,
    });
    const sortie: string[] = [];
    term.surSortie((t) => sortie.push(t));
    expect(sortie.join('')).toContain('session tmux « claude-1 » (démo)');
  });
});
