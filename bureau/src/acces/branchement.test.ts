import { describe, expect, test } from 'bun:test';
import type { VueAcces } from '../../../commun/api-clients.ts';
import { commandeClaudeCode, nomLisible, nomPropose, regrouperAcces, urlConnecteur } from './branchement.ts';

const acces = (genre: VueAcces['genre'], nom: string): VueAcces => ({
  id: 'abcdef012345', nom, genre, creeLe: '', expireLe: '', vuLe: null, courant: false,
});

describe('branchement', () => {
  test('URL du connecteur et commande Claude Code', () => {
    expect(urlConnecteur('https://relais.example.com/', 'J')).toBe('https://relais.example.com/mcp/J');
    expect(commandeClaudeCode('https://relais.example.com', 'J')).toBe(
      'claude mcp add --transport http --scope user quart https://relais.example.com/mcp'
        + ' --header "Authorization: Bearer J"',
    );
  });
  test('user-agent raccourci, nom simple gardé', () => {
    const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
    expect(nomLisible(firefox)).toBe('Firefox · Linux');
    expect(nomLisible('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Safari/604.1')).toBe('Safari · iPhone');
    expect(nomLisible('Quart bureau')).toBe('Quart bureau');
  });
  test('regroupement : connecteurs Claude d’abord, groupes vides omis', () => {
    const g = regrouperAcces([acces('appareil', 'a'), acces('claude-ai', 'b')]);
    expect(g.map((x) => x.genre)).toEqual(['claude-ai', 'appareil']);
  });
  test('nom proposé sans doublon', () => {
    expect(nomPropose('claude-ai', [])).toBe('claude.ai');
    expect(nomPropose('claude-ai', [acces('claude-ai', 'claude.ai')])).toBe('claude.ai 2');
  });
});
