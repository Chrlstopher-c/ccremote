// Responsabilité : le serveur MCP stdio `lanterne` des sessions Claude Code ouvertes hors de Lanterne — deux outils de
// modules (modules_lister, module_appeler), relayés au poste par son socket local. Lancé par Claude Code
// (`bun run poste/presentation/mcp-externe.ts`) ; sur stdout, seul le protocole MCP ; le journal va sur stderr.
// Session déjà pilotée par le poste (LANTERNE_SESSION_PILOTEE = son id) : aucun outil ici, ils viennent du poste.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import pino, { type Logger } from 'pino';
import {
  DESCRIPTION_MODULE_APPELER,
  DESCRIPTION_MODULES_LISTER,
  SCHEMA_MODULE_APPELER,
  SCHEMA_MODULES_LISTER,
} from './modules-declaration.ts';
import { appelerHorsSession, type LienModules, listerModules } from './modules-outils.ts';
import type { Resultat } from './outils.ts';
import { requeteOutils } from './lien-outils-externe.ts';
import { cheminSocketOutils, VAR_SESSION_PILOTEE } from './socket-outils.ts';

const NOM_SERVEUR = 'lanterne';

interface ResultatMcp {
  [cle: string]: unknown;
  readonly content: { readonly type: 'text'; readonly text: string }[];
  readonly isError?: boolean;
}

function enResultat(r: Resultat): ResultatMcp {
  return { content: [{ type: 'text' as const, text: r.texte }], ...(r.erreur ? { isError: true } : {}) };
}

/** Le serveur : les deux outils, ou aucun quand la session est déjà pilotée par le poste. */
export function creerServeurExterne(lien: LienModules, pilotee: boolean): McpServer {
  const serveur = new McpServer({ name: NOM_SERVEUR, version: '1.0.0' }, { capabilities: { tools: {} } });
  if (pilotee) {
    serveur.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
    return serveur;
  }
  serveur.registerTool(
    'modules_lister',
    { description: DESCRIPTION_MODULES_LISTER, inputSchema: SCHEMA_MODULES_LISTER },
    async () => enResultat(await listerModules(lien)),
  );
  serveur.registerTool(
    'module_appeler',
    { description: DESCRIPTION_MODULE_APPELER, inputSchema: SCHEMA_MODULE_APPELER },
    async (a) => enResultat(await appelerHorsSession(lien, a)),
  );
  return serveur;
}

function journalExterne(): Logger {
  return pino(
    { name: 'lanterne-externe', level: process.env['CCREMOTE_NIVEAU_LOG'] ?? 'info' },
    pino.destination({ dest: 2, sync: true }),
  );
}

async function principal(): Promise<void> {
  const journal = journalExterne();
  const donnees = join(homedir(), '.local', 'share', 'ccremote', 'poste');
  const chemin = cheminSocketOutils(process.env, process.getuid?.(), donnees);
  const lien: LienModules = { journal, relais: (quoi, args) => requeteOutils(chemin, quoi, args) };
  const pilotee = Boolean(process.env[VAR_SESSION_PILOTEE]);
  await creerServeurExterne(lien, pilotee).connect(new StdioServerTransport());
  journal.info({ chemin, pilotee }, 'outils hors Lanterne prêts');
}

if (import.meta.main) await principal();
