// Responsabilité : tests du confinement d'une session d'invité — le crochet et la permission refusent les chemins hors
// de l'espace (liens symboliques compris), les URL vers des adresses privées, et tout échec de vérification.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import pino from 'pino';
import type { CadreInvite } from '../../commun/cadre-invite.ts';
import type { Confinement } from '../../commun/invites-outils.ts';
import { confinementDe, crochetConfinement, permissionInvite, verdictOutil } from './confinement-invite.ts';

const journal = pino({ level: 'silent' });
const jetables: string[] = [];
const signal = new AbortController().signal;

afterEach(() => {
  for (const dossier of jetables.splice(0)) rmSync(dossier, { recursive: true, force: true });
});

interface Montage {
  readonly espace: string;
  readonly dehors: string;
  readonly c: Confinement;
}

function montage(): Montage {
  const racine = mkdtempSync(join(tmpdir(), 'confinement-invite-test-'));
  jetables.push(racine);
  const espace = join(racine, 'espace');
  const dehors = join(racine, 'dehors');
  mkdirSync(espace);
  mkdirSync(dehors);
  const cadre: CadreInvite = {
    membre: 'abcdefabcdef',
    nom: 'Elie',
    espace,
    config: join(racine, 'config'),
    lecture: [],
    prompt: '',
    remoteControl: false,
  };
  return { espace: realpathSync(espace), dehors: realpathSync(dehors), c: confinementDe(cadre) };
}

async function permis(m: Montage, nom: string, entree: Record<string, unknown>): Promise<boolean> {
  return (await verdictOutil(m.c, nom, entree, journal)).ok;
}

describe('chemins', () => {
  test('refuse la lecture des identifiants du compte Claude, de .claude, et les remontées', async () => {
    const m = montage();
    expect(await permis(m, 'Read', { file_path: join(homedir(), '.claude', '.credentials.json') })).toBe(false);
    expect(await permis(m, 'Read', { file_path: `${m.espace}/../x` })).toBe(false);
    expect(await permis(m, 'Read', { file_path: '~/.claude/.credentials.json' })).toBe(false);
  });

  test('refuse un motif Glob absolu hors de l’espace', async () => {
    expect(await permis(montage(), 'Glob', { pattern: '/home/**' })).toBe(false);
  });

  test('permet l’écriture et la lecture dans l’espace', async () => {
    const m = montage();
    expect(await permis(m, 'Write', { file_path: `${m.espace}/notes.md`, content: 'x' })).toBe(true);
    expect(await permis(m, 'Read', { file_path: `${m.espace}/notes.md` })).toBe(true);
    expect(await permis(m, 'Glob', { pattern: '**/*.md' })).toBe(true);
  });

  test('refuse un lien symbolique de l’espace vers l’extérieur, en écriture comme en lecture', async () => {
    const m = montage();
    symlinkSync(m.dehors, join(m.espace, 'lien'));
    expect(await permis(m, 'Write', { file_path: `${m.espace}/lien/x.md`, content: 'x' })).toBe(false);
    expect(await permis(m, 'Read', { file_path: `${m.espace}/lien/secret` })).toBe(false);
  });

  test('refuse un lien symbolique cassé (sa cible ne peut pas être vérifiée)', async () => {
    const m = montage();
    symlinkSync(join(m.dehors, 'absent'), join(m.espace, 'casse'));
    expect(await permis(m, 'Write', { file_path: `${m.espace}/casse`, content: 'x' })).toBe(false);
  });
});

describe('outils', () => {
  test('refuse Bash, les outils de tâche et les outils MCP', async () => {
    const m = montage();
    expect(await permis(m, 'Bash', { command: 'id' })).toBe(false);
    expect(await permis(m, 'Task', { prompt: 'x' })).toBe(false);
    expect(await permis(m, 'mcp__lanterne__reseau_inviter', { membre: 'abcdefabcdef' })).toBe(false);
  });

  test('WebFetch : boucle locale et nom sans point refusés avant toute résolution', async () => {
    const m = montage();
    expect(await permis(m, 'WebFetch', { url: 'http://127.0.0.1:1/' })).toBe(false);
    expect(await permis(m, 'WebFetch', { url: 'http://localhost/' })).toBe(false);
    expect(await permis(m, 'WebFetch', { url: 'http://intranet/' })).toBe(false);
  });

  test('WebFetch vers une adresse publique (littérale, sans réseau) : permis', async () => {
    expect(await permis(montage(), 'WebFetch', { url: 'https://203.0.113.10/' })).toBe(true);
  });
});

describe('échec fermé', () => {
  test('une erreur pendant la vérification refuse l’outil', async () => {
    const m = montage();
    const casse: Confinement = { ...m.c, resoudre: () => { throw new Error('realpath impossible'); } };
    expect((await verdictOutil(casse, 'Read', { file_path: `${m.espace}/a` }, journal)).ok).toBe(false);
  });

  test('crochet : refus au format deny, aucun champ de décision pour un appel permis', async () => {
    const m = montage();
    const hook = crochetConfinement(m.c, journal).hooks[0];
    if (!hook) throw new Error('crochet absent');
    const base = { session_id: 's', transcript_path: '', cwd: m.espace, permission_mode: 'default', tool_use_id: 't1' };
    // Entrée partielle : seuls les champs lus par le crochet sont fournis.
    const refuse = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'id' } };
    const sortie = await hook(refuse as unknown as HookInput, 't1', { signal });
    expect(sortie).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'outil non permis : Bash',
      },
    });
    const permis = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: `${m.espace}/n.md` } };
    expect(await hook(permis as unknown as HookInput, 't2', { signal })).toEqual({});
  });

  test('permission : deny pour un outil hors cadre, allow dans l’espace, jamais de question', async () => {
    const m = montage();
    const autoriser = permissionInvite(m.c, journal);
    const options = { signal, suggestions: [], toolUseID: 't', requestId: 'r' };
    const refus = await autoriser('Bash', { command: 'id' }, options);
    expect(refus?.behavior).toBe('deny');
    const ok = await autoriser('Write', { file_path: `${m.espace}/n.md`, content: 'x' }, options);
    expect(ok).toEqual({ behavior: 'allow', updatedInput: { file_path: `${m.espace}/n.md`, content: 'x' } });
  });
});
