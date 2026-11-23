// Responsabilité : tests d'une session SDK en cours — mode de permission (demandes d'outil, file d'attente), réglages
// (modèle, effort, titre) appliqués à la requête vivante.
import { describe, expect, test } from 'bun:test';
import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { attendre, nouvelleSession, type RequeteFausse } from './faux-sdk.ts';

const REGLE: PermissionUpdate = { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' };

function demander(
  requete: RequeteFausse,
  nom: string,
  entree: Record<string, unknown>,
  suggestions: PermissionUpdate[] = [],
): Promise<PermissionResult | null> {
  const autoriser = requete.options.canUseTool;
  if (!autoriser) throw new Error('canUseTool absent des options');
  return autoriser(nom, entree, { signal: new AbortController().signal, suggestions, toolUseID: 't-1', requestId: 'r-1' });
}

describe('mode de permission en cours de session', () => {
  test('mode bypass : un outil ordinaire passe sans dialogue', async () => {
    const decisions: (PermissionResult | null)[] = [];
    const { session } = nouvelleSession(async (_t, requete) => {
      decisions.push(await demander(requete, 'Bash', { command: 'ls' }));
      return [{ type: 'result' }];
    });
    await session.lancer('ls');
    await attendre(() => decisions.length === 1);
    expect(session.resume.dialogue ?? null).toBeNull();
    expect(decisions[0]).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
  });

  test('mode default : la demande devient un dialogue de permission, Autoriser rend allow', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('ménage');
    expect(await session.reglerSession({ kind: 'mode', mode: 'default' })).toBeNull();
    expect(requetes[0]?.reglages).toEqual(['mode:default']);
    expect(session.resume.mode).toBe('default');
    const pending = demander(requetes[0] as RequeteFausse, 'Bash', { command: 'rm x' });
    await attendre(() => session.resume.statut === 'question');
    const dialogue = session.resume.dialogue;
    expect(dialogue?.permission).toEqual({ outil: 'Bash', entree: '{\n "command": "rm x"\n}', suggestion: false });
    expect(dialogue?.options.map((o) => o.libelle)).toEqual(['Autoriser', 'Toujours autoriser', 'Refuser']);
    expect(await session.repondre({ id: dialogue?.id ?? '', index: 0 })).toBeNull();
    expect(await pending).toEqual({ behavior: 'allow', updatedInput: { command: 'rm x' } });
    expect(session.resume.dialogue ?? null).toBeNull();
  });

  test('Toujours autoriser transmet les règles proposées ; Refuser rend deny avec le motif', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('x');
    await session.reglerSession({ kind: 'mode', mode: 'default' });
    const r = requetes[0] as RequeteFausse;
    const toujours = demander(r, 'Bash', { command: 'ls' }, [REGLE]);
    await attendre(() => session.resume.statut === 'question');
    await session.repondre({ id: session.resume.dialogue?.id ?? '', index: 1 });
    expect(await toujours).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' }, updatedPermissions: [REGLE] });
    const refus = demander(r, 'Write', { file_path: '/a' });
    await attendre(() => session.resume.statut === 'question');
    await session.repondre({ id: session.resume.dialogue?.id ?? '', index: 2 });
    expect(await refus).toEqual({ behavior: 'deny', message: 'Refusé par l’utilisateur' });
  });

  test('deux demandes à la fois : la seconde attend la première, puis s’affiche', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('x');
    await session.reglerSession({ kind: 'mode', mode: 'default' });
    const r = requetes[0] as RequeteFausse;
    const premiere = demander(r, 'Bash', { command: '1' });
    const seconde = demander(r, 'Edit', { file_path: '/b' });
    await attendre(() => session.resume.dialogue?.permission?.outil === 'Bash');
    await session.repondre({ id: session.resume.dialogue?.id ?? '', index: 0 });
    expect(await premiere).toEqual({ behavior: 'allow', updatedInput: { command: '1' } });
    await attendre(() => session.resume.dialogue?.permission?.outil === 'Edit');
    await session.repondre({ id: session.resume.dialogue?.id ?? '', index: 2 });
    expect(await seconde).toEqual({ behavior: 'deny', message: 'Refusé par l’utilisateur' });
    expect(session.resume.dialogue ?? null).toBeNull();
  });

  test('interrompre refuse toute la file, la courante comme les suivantes', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('x');
    await session.reglerSession({ kind: 'mode', mode: 'default' });
    const r = requetes[0] as RequeteFausse;
    const a = demander(r, 'Bash', { command: 'a' });
    const b = demander(r, 'Bash', { command: 'b' });
    await attendre(() => session.resume.statut === 'question');
    await session.interrompre();
    expect(await a).toEqual({ behavior: 'deny', message: 'Interrompu par l’utilisateur', interrupt: true });
    expect(await b).toEqual({ behavior: 'deny', message: 'Interrompu par l’utilisateur', interrupt: true });
  });
});

describe('réglages en cours de session', () => {
  test('modèle : appliqué à la requête vivante, « défaut » rend le défaut du SDK', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('x');
    expect(await session.reglerSession({ kind: 'modele', modele: 'claude-opus-5-5' })).toBeNull();
    expect(await session.reglerSession({ kind: 'modele', modele: 'défaut' })).toBeNull();
    expect(requetes[0]?.reglages).toEqual(['modele:claude-opus-5-5', 'modele:défaut']);
    expect(session.resume.modele).toBe('défaut');
  });

  test('effort : appliqué par réglage de session ; null rend le défaut', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('x');
    await session.reglerSession({ kind: 'effort', effort: 'max' });
    await session.reglerSession({ kind: 'effort', effort: null });
    expect(requetes[0]?.reglages).toEqual(['effort:max', 'effort:défaut']);
    expect(session.resume.effort).toBeNull();
  });

  test('sans requete vivante : le réglage est gardé pour le prochain démarrage, sans erreur', async () => {
    const { session, requetes } = nouvelleSession(async () => []);
    expect(await session.reglerSession({ kind: 'mode', mode: 'plan' })).toBeNull();
    expect(await session.reglerSession({ kind: 'effort', effort: 'high' })).toBeNull();
    expect(requetes).toHaveLength(0);
    expect(session.resume.mode).toBe('plan');
    expect(session.resume.effort).toBe('high');
  });

  test('renommer : le titre change, sans toucher à la requête', async () => {
    const { session, requetes } = nouvelleSession(async () => []);
    expect(await session.reglerSession({ kind: 'renommer', titre: 'Nouveau nom' })).toBeNull();
    expect(session.resume.titre).toBe('Nouveau nom');
    expect(requetes).toHaveLength(0);
  });
});
