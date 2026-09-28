// Responsabilité : serveur MCP stdio des trois outils de rythme d'une session pilotée (étape, fin, question).
// Lancé par Claude Code lui-même ; chaque appel est relayé au poste, qui décide de la suite (compaction, relance).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const session = process.env['CCREMOTE_SESSION'] ?? '';
const socket = process.env['CCREMOTE_SOCKET'] ?? '';

async function relayer(outil: string, args: Record<string, string>): Promise<{ content: { type: 'text'; text: string }[] }> {
  let texte: string;
  try {
    const r = await fetch(`http://poste/rythme/${outil}?session=${encodeURIComponent(session)}`, {
      method: 'POST', body: JSON.stringify(args), unix: socket, signal: AbortSignal.timeout(15_000),
    } as RequestInit);
    texte = r.ok ? await r.text() : `ccremote a refusé l’appel (${r.status}) : continue normalement.`;
  } catch (erreur) {
    texte = `ccremote injoignable (${String(erreur)}) : continue normalement.`;
  }
  return { content: [{ type: 'text', text: texte }] };
}

const serveur = new McpServer({ name: 'ccremote', version: '2.0.0' });
serveur.registerTool('etape_terminee', {
  description: 'Signale un palier livré et vérifié. Le harness décide s’il compacte la session.',
  inputSchema: { resume: z.string().describe('Ce qui a été livré, en 1 à 3 phrases'), suite: z.string().describe('La prochaine étape') },
}, (a) => relayer('etape_terminee', a));
serveur.registerTool('objectif_atteint', {
  description: 'Déclare l’objectif de la session atteint et vérifié. Chris est notifié.',
  inputSchema: { bilan: z.string().describe('Bilan honnête : livré, vérifié, reste éventuel') },
}, (a) => relayer('objectif_atteint', a));
serveur.registerTool('poser_question', {
  description: 'Pose à Chris une question qu’il est seul à pouvoir trancher. Il est notifié.',
  inputSchema: { question: z.string().describe('La question, avec ta recommandation') },
}, (a) => relayer('poser_question', a));

await serveur.connect(new StdioServerTransport());
