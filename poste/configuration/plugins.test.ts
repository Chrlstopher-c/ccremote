import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { SortieCommande } from './exec.ts';
import { activerPlugin, analyserPlugins, pluginAffiche } from './plugins.ts';

const journal = pino({ level: 'silent' });
let racine = '';

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'plugins-'));
});
afterEach(() => rmSync(racine, { recursive: true, force: true }));

function listeDe(): string {
  return JSON.stringify([
    { id: 'exemple@marche', version: '2.0.0', scope: 'user', enabled: true, installPath: join(racine, 'exemple') },
    { id: 'autre@marche', version: '0.1.0', scope: 'project', enabled: false },
  ]);
}

function lancerSimule(
  reponses: SortieCommande[],
  appels: string[][],
): (args: readonly string[]) => Promise<SortieCommande> {
  return async (args) => {
    appels.push([...args]);
    return reponses.shift() ?? { code: 0, sortie: listeDe(), erreurs: '', delaiDepasse: false };
  };
}

describe('plug-ins', () => {
  test('analyse la liste JSON ; une forme inattendue donne une liste vide', () => {
    expect(analyserPlugins(listeDe(), journal).map((p) => p.id)).toEqual(['exemple@marche', 'autre@marche']);
    expect(analyserPlugins('{"pas": "une liste"}', journal)).toEqual([]);
    expect(analyserPlugins('pas du json', journal)).toEqual([]);
  });

  test('description lue dans le manifeste du plug-in, vide sans manifeste', () => {
    const dossier = join(racine, 'exemple');
    mkdirSync(join(dossier, '.claude-plugin'), { recursive: true });
    writeFileSync(join(dossier, '.claude-plugin', 'plugin.json'), JSON.stringify({ description: 'Démo fictive' }));
    const [exemple, autre] = analyserPlugins(listeDe(), journal);
    expect(pluginAffiche(exemple!, journal)).toEqual({
      id: 'exemple@marche',
      version: '2.0.0',
      portee: 'user',
      actif: true,
      description: 'Démo fictive',
    });
    expect(pluginAffiche(autre!, journal).description).toBe('');
  });

  test('activer appelle la CLI avec l’identifiant, puis rend l’élément relu', async () => {
    const appels: string[][] = [];
    const r = await activerPlugin(
      lancerSimule([{ code: 0, sortie: '', erreurs: '', delaiDepasse: false }], appels),
      'autre@marche',
      true,
      journal,
    );
    expect(appels[0]).toEqual(['plugin', 'enable', 'autre@marche']);
    expect(r.ok && r.plugin.id).toBe('autre@marche');
  });

  test('échec de la CLI : erreur lisible, pas de relecture', async () => {
    const appels: string[][] = [];
    const echec = { code: 1, sortie: '', erreurs: 'erreur\nplug-in inconnu', delaiDepasse: false };
    const r = await activerPlugin(lancerSimule([echec], appels), 'x@y', false, journal);
    expect(r).toEqual({ ok: false, erreur: 'plug-in inconnu' });
    expect(appels.map((a) => a[1])).toEqual(['disable']);
  });
});
