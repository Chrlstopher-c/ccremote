/**
 * `☠` LE défaut le plus durable trouvé sur ce dépôt : depuis l'origine du
 * harness, **aucune équipe n'a jamais eu un seul serveur MCP**.
 *
 * Relevé le 01/08 dans `~/.claude-comptes/compte-a/.claude.json` :
 * `mcpServers: []` à la racine, et aucun MCP sur les quatre projets déclarés.
 * Pendant ce temps le mandat système du lead lui ordonnait, mot pour mot :
 * « Utilise les MCP à disposition (Playwright, Log Watcher, pty-mcp…) pour
 * valider réellement — lire du code ne suffit pas. »
 *
 * Ni erreur, ni avertissement, ni test rouge. Le lead se rabattait sur le shell
 * et validait moins bien, en beaucoup plus de tours — et les tours sont ce qu'on
 * paie. Onzième occurrence du motif « écrit, testé, branché sur rien », et la
 * seule qui ait duré depuis le premier jour.
 *
 * `☠` La cause n'était PAS un oubli mais un chemin incapable d'appliquer
 * l'intention : `options-composition.ts` posait que les MCP « appartiennent au
 * PC » et arrivent par `settingSources`. Or `settingSources` charge
 * `settings.json`, tandis que les serveurs MCP vivent dans `.claude.json` — le
 * fichier que `CLAUDE_CONFIG_DIR` remplace précisément par celui du compte
 * isolé, qui est vide. Même forme que le défaut d'effort du 31/07 : un réglage
 * qu'on croit posé et qui n'atteint jamais son point de consommation.
 *
 * Ces tests gardent les deux moitiés : ce qu'on transmet, et le fait que
 * l'absence se DISE au lieu de se subir.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCP_EQUIPE, resoudreMcpEquipe } from './mcp-du-poste.ts';
import { assertOptionsInvariants, composeWorkerOptions } from './options-composition.ts';
import type { ResolvedModel, WorkerSpec } from './types.ts';

const MODELE: ResolvedModel = { requested: 'sonnet', resolved: 'claude-sonnet-5', tier: 'sonnet', viaInheritance: false };

function specAvec(mcpServers: WorkerSpec['mcpServers']): WorkerSpec {
  return {
    sessionId: '11111111-2222-3333-4444-555555555555',
    cwd: '/tmp/worktree',
    mandate: 'mandat',
    deniedToolPatterns: [],
    maxBudgetUsd: 25,
    mcpServers,
    portAuditPermissions: () => ({}),
  };
}

/** Un `.claude.json` de poste, écrit sous `os.tmpdir()` — le test crée ce qu'il valide. */
function postePropose(noms: readonly string[]): string {
  const dossier = mkdtempSync(join(tmpdir(), 'mcp-poste-'));
  const chemin = join(dossier, '.claude.json');
  const mcpServers = Object.fromEntries(
    noms.map((n) => [n, { type: 'stdio', command: `/opt/${n}/bin/python`, args: [`/opt/${n}/server.py`], env: {} }]),
  );
  writeFileSync(chemin, JSON.stringify({ mcpServers }), 'utf8');
  return chemin;
}

describe('ce que le poste met à disposition d’une équipe', () => {
  test('les serveurs attendus sont lus depuis la config du poste', () => {
    const r = resoudreMcpEquipe(postePropose(MCP_EQUIPE));
    expect(Object.keys(r.serveurs).sort()).toEqual([...MCP_EQUIPE].sort());
    expect(r.manquants).toEqual([]);
  });

  test('☠ tout ce que le poste déclare n’est PAS transmis — la liste est nommée', () => {
    // `discord-control` parle au monde extérieur au nom de Chris, `bug-bounty`
    // est offensif et suppose un engagement vérifié par un humain. Une équipe
    // autonome qui tourne la nuit ne doit avoir ni l'un ni l'autre.
    const r = resoudreMcpEquipe(postePropose([...MCP_EQUIPE, 'discord-control', 'bug-bounty', 'echohub']));
    expect(Object.keys(r.serveurs)).not.toContain('discord-control');
    expect(Object.keys(r.serveurs)).not.toContain('bug-bounty');
    expect(Object.keys(r.serveurs)).not.toContain('echohub');
  });

  test('☠ les outils dont dépend la validation E2E sont bien du lot', () => {
    // Ce sont ceux que le mandat système NOMME au lead. Un prompt qui promet une
    // capacité absente est le défaut `WebSearch` du 01/08 — ici à l'échelle de
    // toute la boîte à outils.
    for (const outil of ['playwright', 'log-watcher', 'codeindex', 'semantic-memory']) {
      expect(MCP_EQUIPE).toContain(outil);
    }
  });

  test('☠ un poste illisible ne fait pas échouer la résolution — mais elle le DIT', () => {
    // Une équipe doit pouvoir démarrer sans MCP (poste neuf, config déplacée).
    // Ce qui n'est pas acceptable, c'est de ne pas le savoir : c'est exactement
    // sous ce silence que le défaut a vécu depuis l'origine.
    const r = resoudreMcpEquipe(join(tmpdir(), 'nexiste-pas-', String(Date.now()), '.claude.json'));
    expect(r.serveurs).toEqual({});
    expect(r.manquants).toEqual([...MCP_EQUIPE]);
  });

  test('un serveur attendu mais non déclaré est signalé nommément', () => {
    const r = resoudreMcpEquipe(postePropose(['codeindex']));
    expect(Object.keys(r.serveurs)).toEqual(['codeindex']);
    expect(r.manquants).toContain('playwright');
    expect(r.manquants).not.toContain('codeindex');
  });
});

describe('la transmission jusqu’aux options du worker', () => {
  test('☠ les serveurs résolus arrivent RÉELLEMENT dans les options du SDK', () => {
    // Le test qui manquait. Sans lui, `resoudreMcpEquipe` pourrait être parfaite
    // et n'être branchée sur rien — ce qui est littéralement l'histoire de ce
    // défaut : une intention juste, jamais transportée jusqu'au SDK.
    const serveurs = { playwright: { type: 'stdio' as const, command: '/opt/pw/python', args: ['/opt/pw/s.py'] } };
    const { options } = composeWorkerOptions(specAvec(serveurs), MODELE);
    expect(options.mcpServers).toEqual(serveurs);
  });

  test('un poste sans MCP donne un objet vide — jamais `undefined`', () => {
    const { options } = composeWorkerOptions(specAvec({}), MODELE);
    expect(options.mcpServers).toEqual({});
  });

  test('☠ l’invariant refuse des options sans `mcpServers`', () => {
    // Le garde-fou du point d'assemblage : `undefined` est indiscernable d'un
    // poste sans MCP, et c'est sous ce masque que le défaut est resté invisible.
    const { options } = composeWorkerOptions(specAvec({}), MODELE);
    const sansMcp = { ...options };
    delete (sansMcp as { mcpServers?: unknown }).mcpServers;
    expect(() => assertOptionsInvariants(sansMcp)).toThrow(/mcpServers absent/);
  });
});
