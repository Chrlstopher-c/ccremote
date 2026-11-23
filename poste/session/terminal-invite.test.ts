import { describe, expect, test } from 'bun:test';
import { verifierOutil, type Confinement } from '../../commun/invites-outils.ts';
import { terminalPermis } from './confinement-invite.ts';
import type { CadreInvite } from '../../commun/cadre-invite.ts';

const base: CadreInvite = {
  membre: 'abcdefabcdef', nom: 'Elie', espace: '/tmp/espace', config: '/tmp/config', lecture: [], prompt: '',
  remoteControl: false,
};
const relais = { url: 'http://127.0.0.1:1/api/relais-claude', jeton: 'x'.repeat(40) };
const confinement = (terminal: boolean): Confinement => ({
  terminal, espace: '/tmp/espace', lecture: [], home: '/home/x', resoudre: (c) => c,
});

describe('terminal d’un invité', () => {
  test('accordé et session sur sa machine : permis', () => {
    expect(terminalPermis({ ...base, terminaux: true, relais })).toBe(true);
  });
  test('accordé mais session chez le chef (sans relais) : refusé', () => {
    expect(terminalPermis({ ...base, terminaux: true })).toBe(false);
  });
  test('non accordé : refusé', () => {
    expect(terminalPermis({ ...base, terminaux: false, relais })).toBe(false);
  });
  test('outils de Noctis : permis seulement à une session sur la machine de l’invité', () => {
    const local: Confinement = { ...confinement(false), local: true };
    expect(verifierOutil(local, 'mcp__lanterne__artefact_creer', {}).ok).toBe(true);
    expect(verifierOutil(confinement(false), 'mcp__lanterne__artefact_creer', {}).ok).toBe(false);
    expect(verifierOutil(local, 'mcp__autre__x', {}).ok).toBe(false);
  });
  test('le confinement laisse passer Bash seulement si le terminal est permis', () => {
    expect(verifierOutil(confinement(true), 'Bash', { command: 'ls' }).ok).toBe(true);
    expect(verifierOutil(confinement(false), 'Bash', { command: 'ls' }).ok).toBe(false);
  });
});
