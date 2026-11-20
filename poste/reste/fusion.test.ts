// Responsabilité : tests de la demande de fusion (P3) sur un dépôt git jetable, un `origin` nu local et un faux `gh`
// écrit dans le dossier temporaire du test. Aucun dépôt réel, aucune PR réelle.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { creerFusion, etatFusion } from './fusion.ts';

const journal = pino({ level: 'silent' });
const TITRE = 'Ajout "spécial" ; echo $HOME';
const IDENTITE = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

let racine = '';
let cheminPathOriginal = '';
let depot = '';
let bin = '';
let etat = '';

// Faux `gh` : `pr view` lit `etat/pr.json` (sinon « aucune PR »), `pr create` l'écrit ; état dans le dossier du test.
function fauxGh(): string {
  return `#!/bin/sh
ETAT="${etat}"
case "$1 $2" in
  "pr view")
    if [ -f "$ETAT/pr.json" ]; then cat "$ETAT/pr.json"; exit 0; fi
    echo 'no pull requests found for branch "feature"' >&2
    exit 1 ;;
  "pr create")
    TITRE=""; BROUILLON=false
    for a in "$@"; do
      case "$a" in
        --title=*) TITRE="\${a#--title=}" ;;
        --draft) BROUILLON=true ;;
      esac
    done
    TITRE_JSON=$(printf '%s' "$TITRE" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    { printf '{"number":7,"title":"%s","url":"https://exemple.invalide/pr/7","state":"OPEN",' "$TITRE_JSON"
      printf '"isDraft":%s}\\n' "$BROUILLON"; } > "$ETAT/pr.json"
    echo "https://exemple.invalide/pr/7"
    exit 0 ;;
esac
exit 2
`;
}

function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(['git', ...args], { cwd, env: { ...process.env, ...IDENTITE } });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
}

function ecrire(chemin: string, texte: string): void {
  mkdirSync(join(chemin, '..'), { recursive: true });
  writeFileSync(chemin, texte);
  chmodSync(chemin, 0o755);
}

beforeAll(() => {
  racine = mkdtempSync(join(tmpdir(), 'fusion-'));
  cheminPathOriginal = process.env.PATH ?? '';
  etat = join(racine, 'etat');
  bin = join(racine, 'bin');
  mkdirSync(etat, { recursive: true });
  ecrire(join(bin, 'gh'), fauxGh());
  git(racine, 'init', '--bare', '-q', '-b', 'main', 'origin.git');
  depot = join(racine, 'depot');
  git(racine, 'init', '-q', '-b', 'feature', 'depot');
  writeFileSync(join(depot, 'a.txt'), 'bonjour\n');
  git(depot, 'add', 'a.txt');
  git(depot, 'commit', '-q', '-m', 'premier');
  git(depot, 'remote', 'add', 'origin', join(racine, 'origin.git'));
  process.env.PATH = `${bin}:${cheminPathOriginal}`;
});

afterAll(() => {
  process.env.PATH = cheminPathOriginal;
  rmSync(racine, { recursive: true, force: true });
});

describe('demande de fusion (P3)', () => {
  test('aucune PR sur la branche : pr null, branche lue par git', async () => {
    expect(await etatFusion(depot, journal)).toEqual({ etat: 'ok', branche: 'feature', pr: null });
  });

  test('création en brouillon : push sur origin, PR créée avec le titre tel quel, relue', async () => {
    const r = await creerFusion(depot, { titre: TITRE, corps: 'Corps', brouillon: true }, journal);
    expect(r).toEqual({
      etat: 'ok',
      pr: { numero: 7, titre: TITRE, url: 'https://exemple.invalide/pr/7', etat: 'DRAFT' },
    });
    expect(git(join(racine, 'origin.git'), 'branch', '--list', 'feature')).toContain('feature');
  });

  test('la PR créée est lue ensuite par l’état de la session', async () => {
    const e = await etatFusion(depot, journal);
    expect(e).toEqual({
      etat: 'ok',
      branche: 'feature',
      pr: { numero: 7, titre: TITRE, url: 'https://exemple.invalide/pr/7', etat: 'DRAFT' },
    });
  });

  test('push impossible (aucun origin) : erreur lisible, aucune PR', async () => {
    const seul = join(racine, 'sans-origin');
    git(racine, 'init', '-q', '-b', 'autre', 'sans-origin');
    writeFileSync(join(seul, 'b.txt'), 'x\n');
    git(seul, 'add', 'b.txt');
    git(seul, 'commit', '-q', '-m', 'b');
    const r = await creerFusion(seul, { titre: 'T', corps: '', brouillon: false }, journal);
    expect(r.etat).toBe('erreur');
    expect(r.etat === 'erreur' && r.raison.startsWith('push impossible')).toBe(true);
  });

  test('dossier non suivi par git : état absent, raison en français', async () => {
    const hors = join(racine, 'hors-git');
    mkdirSync(hors);
    expect(await etatFusion(hors, journal)).toEqual({
      etat: 'absente',
      raison: 'dossier non suivi par git, ou sans commit',
    });
  });

  test('gh absent du PATH : état absent, sans erreur levée', async () => {
    const seulGit = join(racine, 'seul-git');
    mkdirSync(seulGit, { recursive: true });
    const git = Bun.which('git');
    if (git === null) throw new Error('git introuvable pour le test');
    symlinkSync(git, join(seulGit, 'git'));
    process.env.PATH = seulGit;
    try {
      expect(await etatFusion(depot, journal)).toEqual({ etat: 'absente', raison: 'gh introuvable sur ce poste' });
    } finally {
      process.env.PATH = `${bin}:${cheminPathOriginal}`;
    }
  });

  test('gh non connecté : état absent avec la consigne de connexion', async () => {
    const sansConnexion = join(racine, 'gh-sans-connexion');
    ecrire(
      join(sansConnexion, 'gh'),
      '#!/bin/sh\necho "To get started with GitHub CLI, please run:  gh auth login" >&2\nexit 4\n',
    );
    process.env.PATH = `${sansConnexion}:${cheminPathOriginal}`;
    try {
      const e = await etatFusion(depot, journal);
      expect(e).toEqual({ etat: 'absente', raison: 'gh non connecté sur ce poste (gh auth login)' });
    } finally {
      process.env.PATH = `${bin}:${cheminPathOriginal}`;
    }
  });
});
