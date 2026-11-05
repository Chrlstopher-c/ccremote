// Responsabilité : point d'entrée du MCP Quart (stdio) — lit l'adresse du relais et le jeton, branche les outils.
// Config : QUART_URL / QUART_JETON dans l'environnement, sinon ~/.config/quart/mcp.env (600, jamais versionné).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import pino from 'pino';
import { ClientRelais } from './client-relais.ts';
import { enregistrerOutils } from './outils.ts';

// stdout porte le protocole MCP : le journal va sur stderr.
const journal = pino({ name: 'quart-mcp', level: 'info' }, pino.destination(2));

export function lireConfig(env: Record<string, string | undefined>, fichier: string): { url: string; jeton: string } {
  const valeurs: Record<string, string> = {};
  try {
    for (const ligne of readFileSync(fichier, 'utf8').split('\n')) {
      const m = ligne.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m?.[1] && m[2] !== undefined) valeurs[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (e) {
    if (!env['QUART_URL'] || !env['QUART_JETON']) journal.warn({ fichier, erreur: String(e) }, 'config illisible');
  }
  const url = (env['QUART_URL'] ?? valeurs['QUART_URL'] ?? '').replace(/\/+$/, '');
  const jeton = env['QUART_JETON'] ?? valeurs['QUART_JETON'] ?? '';
  if (!url || !jeton) throw new Error(`QUART_URL et QUART_JETON requis (environnement ou ${fichier})`);
  return { url, jeton };
}

if (import.meta.main) {
  const fichier = process.env['QUART_MCP_CONFIG'] ?? join(homedir(), '.config/quart/mcp.env');
  const { url, jeton } = lireConfig(process.env, fichier);
  const serveur = new McpServer({ name: 'quart', version: '1.0.0' });
  enregistrerOutils(serveur, new ClientRelais(url, jeton), (message, erreur) =>
    journal.warn({ erreur: String(erreur) }, message),
  );
  await serveur.connect(new StdioServerTransport());
  journal.info({ url }, 'MCP Quart prêt');
}
