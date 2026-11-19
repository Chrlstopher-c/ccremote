import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { DefinitionConnecteur, MASQUE_VALEUR } from '../../commun/configuration.ts';
import {
  ajouterConnecteur,
  definitionDe,
  fichierConfigClaude,
  jsonClaude,
  lireBrutConnecteur,
  modifierConnecteur,
  retirerConnecteur,
} from './connecteurs-edition.ts';
import type { LanceurClaude, SortieCommande } from './exec.ts';

const journal = pino({ enabled: false });
type Brut = Record<string, unknown>;

function sortie(code: number, erreurs = '', texte = ''): SortieCommande {
  return { code, sortie: texte, erreurs, delaiDepasse: false };
}

// Faux `claude mcp` : applique add-json et remove au fichier de configuration, comme la CLI réelle.
function fauxClaude(echecs: readonly string[] = []): { lancer: LanceurClaude; appels: string[][] } {
  const appels: string[][] = [];
  const lancer: LanceurClaude = async (args) => {
    appels.push([...args]);
    const fichier = fichierConfigClaude();
    const cfg = existsSync(fichier) ? (JSON.parse(readFileSync(fichier, 'utf8')) as { mcpServers?: Brut }) : {};
    const serveurs: Brut = cfg.mcpServers ?? {};
    const [, sous, nom, json] = args;
    if (sous === 'add-json') {
      if (echecs.includes(nom ?? '')) return sortie(1, 'Invalid configuration: échec simulé');
      if (serveurs[nom ?? '']) return sortie(1, `MCP server ${nom} already exists in user config`);
      serveurs[nom ?? ''] = JSON.parse(json ?? '{}') as Brut;
    } else {
      if (!serveurs[nom ?? '']) return sortie(1, `No MCP server named "${nom}" in user scope`);
      delete serveurs[nom ?? ''];
    }
    writeFileSync(fichier, JSON.stringify({ ...cfg, mcpServers: serveurs }));
    return sortie(0, '', 'ok');
  };
  return { lancer, appels };
}

const STDIO: DefinitionConnecteur = DefinitionConnecteur.parse({
  nom: 'echo-test',
  type: 'stdio',
  commande: '/usr/bin/true',
  arguments: ['--a', 'b c'],
  variables: { CLE: 'valeur-fictive' },
});
const HTTP: DefinitionConnecteur = DefinitionConnecteur.parse({
  nom: 'web-test',
  type: 'http',
  url: 'https://exemple.invalide/mcp',
  entetes: { Authorization: 'Bearer jeton-fictif' },
});

let dossier = '';
let ancienDossier: string | undefined;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'connecteurs-edition-'));
  ancienDossier = process.env['CLAUDE_CONFIG_DIR'];
  process.env['CLAUDE_CONFIG_DIR'] = dossier;
  writeFileSync(fichierConfigClaude(), JSON.stringify({ mcpServers: {} }));
});

afterEach(() => {
  if (ancienDossier === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
  else process.env['CLAUDE_CONFIG_DIR'] = ancienDossier;
});

function brutDe(nom: string): Brut | undefined {
  return (JSON.parse(readFileSync(fichierConfigClaude(), 'utf8')) as { mcpServers: Brut }).mcpServers[nom] as Brut;
}

describe('forme des commandes claude', () => {
  test('stdio : command, args, env ; distant : url, headers', () => {
    expect(jsonClaude(STDIO)).toEqual({
      type: 'stdio',
      command: '/usr/bin/true',
      args: ['--a', 'b c'],
      env: { CLE: 'valeur-fictive' },
    });
    expect(jsonClaude(HTTP)).toEqual({
      type: 'http',
      url: 'https://exemple.invalide/mcp',
      headers: { Authorization: 'Bearer jeton-fictif' },
    });
  });

  test('ajout : add-json au niveau utilisateur, JSON identique à la définition', async () => {
    const { lancer, appels } = fauxClaude();
    expect(await ajouterConnecteur(lancer, STDIO)).toEqual({ ok: true });
    expect(appels[0]?.slice(0, 3)).toEqual(['mcp', 'add-json', 'echo-test']);
    expect(appels[0]?.slice(-2)).toEqual(['-s', 'user']);
    expect(JSON.parse(appels[0]?.[3] ?? '')).toEqual(jsonClaude(STDIO));
    expect(brutDe('echo-test')).toEqual(jsonClaude(STDIO));
  });

  test('retrait : remove au niveau utilisateur', async () => {
    const { lancer, appels } = fauxClaude();
    await ajouterConnecteur(lancer, HTTP);
    expect(await retirerConnecteur(lancer, 'web-test')).toEqual({ ok: true });
    expect(appels.at(-1)).toEqual(['mcp', 'remove', 'web-test', '-s', 'user']);
    expect(brutDe('web-test')).toBeUndefined();
  });

  test('erreur de la CLI rendue lisible (dernière ligne utile)', async () => {
    const { lancer } = fauxClaude();
    await ajouterConnecteur(lancer, HTTP);
    expect(await ajouterConnecteur(lancer, HTTP)).toEqual({
      ok: false,
      erreur: 'MCP server web-test already exists in user config',
    });
  });
});

describe('lecture et masquage', () => {
  test('valeurs de variables et d’en-têtes masquées sauf demande explicite', async () => {
    const { lancer } = fauxClaude();
    await ajouterConnecteur(lancer, STDIO);
    await ajouterConnecteur(lancer, HTTP);
    const masque = definitionDe('echo-test', lireBrutConnecteur('echo-test', journal) ?? {}, false);
    expect(masque).toEqual({
      nom: 'echo-test',
      type: 'stdio',
      commande: '/usr/bin/true',
      arguments: ['--a', 'b c'],
      variables: { CLE: MASQUE_VALEUR },
      entetes: {},
    });
    const revele = definitionDe('web-test', lireBrutConnecteur('web-test', journal) ?? {}, true);
    expect(revele).toMatchObject({ type: 'http', url: 'https://exemple.invalide/mcp', entetes: HTTP.entetes });
  });

  test('absent du fichier : rien à lire', () => {
    expect(lireBrutConnecteur('inconnu', journal)).toBeNull();
  });
});

describe('modification', () => {
  test('une valeur masquée renvoyée garde l’ancienne valeur, les autres changent', async () => {
    const { lancer } = fauxClaude();
    await ajouterConnecteur(lancer, STDIO);
    const modifie = DefinitionConnecteur.parse({
      ...STDIO,
      arguments: ['--neuf'],
      variables: { CLE: MASQUE_VALEUR, AUTRE: 'nouvelle' },
    });
    expect(await modifierConnecteur(lancer, journal, 'echo-test', modifie)).toEqual({ ok: true });
    expect(brutDe('echo-test')).toEqual({
      type: 'stdio',
      command: '/usr/bin/true',
      args: ['--neuf'],
      env: { CLE: 'valeur-fictive', AUTRE: 'nouvelle' },
    });
  });

  test('renommer : retirer l’ancien nom, ajouter le nouveau', async () => {
    const { lancer } = fauxClaude();
    await ajouterConnecteur(lancer, HTTP);
    const renomme = DefinitionConnecteur.parse({ ...HTTP, nom: 'web-neuf' });
    expect(await modifierConnecteur(lancer, journal, 'web-test', renomme)).toEqual({ ok: true });
    expect(brutDe('web-test')).toBeUndefined();
    expect(brutDe('web-neuf')).toEqual(jsonClaude(HTTP));
  });

  test('ajout qui échoue : l’ancienne entrée brute est restaurée à l’identique', async () => {
    const { lancer } = fauxClaude(['web-neuf']);
    await ajouterConnecteur(lancer, HTTP);
    const avant = brutDe('web-test');
    const renomme = DefinitionConnecteur.parse({ ...HTTP, nom: 'web-neuf', url: 'https://autre.invalide/mcp' });
    const r = await modifierConnecteur(lancer, journal, 'web-test', renomme);
    expect(r).toEqual({ ok: false, erreur: 'Invalid configuration: échec simulé' });
    expect(brutDe('web-test')).toEqual(avant);
  });

  test('connecteur absent au niveau utilisateur : refus sans toucher au fichier', async () => {
    const { lancer, appels } = fauxClaude();
    expect(await modifierConnecteur(lancer, journal, 'fantome', HTTP)).toEqual({
      ok: false,
      erreur: 'connecteur absent au niveau utilisateur : fantome',
    });
    expect(appels).toHaveLength(0);
  });
});

describe('validation de la définition', () => {
  test('nom : pas d’option ni d’espace', () => {
    expect(DefinitionConnecteur.safeParse({ ...STDIO, nom: '-x' }).success).toBe(false);
    expect(DefinitionConnecteur.safeParse({ ...STDIO, nom: 'a b' }).success).toBe(false);
    expect(DefinitionConnecteur.safeParse({ ...STDIO, nom: 'a_b-1' }).success).toBe(true);
  });

  test('stdio sans commande, distant sans url http(s), mélanges refusés', () => {
    expect(DefinitionConnecteur.safeParse({ nom: 'x', type: 'stdio' }).success).toBe(false);
    expect(DefinitionConnecteur.safeParse({ nom: 'x', type: 'http', url: 'file:///etc/passwd' }).success).toBe(false);
    expect(DefinitionConnecteur.safeParse({ nom: 'x', type: 'sse', url: 'ceci-n-est-pas-une-url' }).success).toBe(
      false,
    );
    expect(DefinitionConnecteur.safeParse({ ...HTTP, commande: '/bin/x' }).success).toBe(false);
    expect(DefinitionConnecteur.safeParse({ ...STDIO, entetes: { A: 'b' } }).success).toBe(false);
  });

  test('valeur masquée à l’ajout : refusée sans appeler la CLI', async () => {
    const { lancer, appels } = fauxClaude();
    const masque = DefinitionConnecteur.parse({ ...STDIO, variables: { CLE: MASQUE_VALEUR } });
    expect((await ajouterConnecteur(lancer, masque)).ok).toBe(false);
    expect(appels).toHaveLength(0);
  });
});
