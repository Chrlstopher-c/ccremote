// Responsabilité : servir le MCP « quart » en HTTP (Streamable HTTP, sans état) pour les connecteurs Claude —
// claude.ai (jeton dans l'URL : /mcp/<jeton>) et Claude Code (/mcp + en-tête Authorization: Bearer).
// Les outils sont ceux de mcp/ ; ils rappellent l'API du relais par la boucle locale, avec le jeton du connecteur.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Logger } from 'pino';
import { ClientRelais } from '../../mcp/client-relais.ts';
import { enregistrerOutils } from '../../mcp/outils.ts';
import type { Acces } from '../acces/acces.ts';
import { extraireJeton } from '../acces/acces.ts';
import { erreur } from '../clients/http.ts';

type RequeteMcp = Request & { params: Record<string, string> };

export function adresseBoucle(hote: string, port: number): string {
  return `http://${hote.includes(':') ? `[${hote}]` : hote}:${port}`;
}

async function servir(req: Request, jeton: string, boucle: string, journal: Logger): Promise<Response> {
  const serveur = new McpServer({ name: 'quart', version: '1.0.0' });
  enregistrerOutils(serveur, new ClientRelais(boucle, jeton), (message, e) =>
    journal.warn({ erreur: String(e) }, message),
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await serveur.connect(transport);
    return await transport.handleRequest(req);
  } catch (e) {
    journal.error({ erreur: String(e) }, 'requête MCP en échec');
    return erreur('erreur interne du MCP', 500);
  } finally {
    void serveur.close();
  }
}

export function routesMcp(acces: Acces, boucle: string, journal: Logger) {
  const traiter = (req: Request, jeton: string | null): Response | Promise<Response> => {
    if (!jeton || acces.genreDuJeton(jeton) === null) {
      return erreur('accès refusé : jeton inconnu, expiré ou révoqué', 401);
    }
    return servir(req, jeton, boucle, journal);
  };
  return {
    '/mcp': (req: Request) => traiter(req, extraireJeton(req)),
    '/mcp/:jeton': (req: RequeteMcp) => traiter(req, req.params['jeton'] ?? null),
    // Pas d'OAuth : la découverte ne doit pas tomber sur l'interface web (index.html).
    '/.well-known/*': () => erreur('introuvable', 404),
  };
}
