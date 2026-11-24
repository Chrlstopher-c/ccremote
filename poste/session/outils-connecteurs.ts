// Responsabilité : l'outil qui laisse l'agent réactiver un connecteur coupé au démarrage de la session (réglage de
// Noctis, 24/11). Un connecteur réactivé AJOUTE ses outils en fin de conversation (le cache du début reste valable) ;
// aucun outil ne coupe en cours de session, ce qui casserait le cache. Serveur en processus : marche aussi sous Windows.
import { createSdkMcpServer, type McpSdkServerConfigWithInstance, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export const NOM_SERVEUR_CONNECTEURS = 'noctis-connecteurs';

export interface ActionsConnecteurs {
  coupes(): readonly string[];
  activer(nom: string): Promise<string | null>;
}

const DESCRIPTION =
  'Certains connecteurs (claude.ai ou MCP locaux : Gmail, Drive, Shopify…) peuvent être coupés au démarrage de ' +
  'la session pour économiser le contexte. Sans `nom` : liste les connecteurs coupés. Avec `nom` : réactive ce ' +
  'connecteur ; ses outils deviennent disponibles juste après (cherche-les avec ToolSearch).';

function texte(t: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: t }] };
}

/** Réponse de l'outil, pure : la liste, une réactivation faite, ou pourquoi elle ne l'est pas. */
export async function repondre(a: ActionsConnecteurs, nom: string | undefined): Promise<string> {
  const coupes = a.coupes();
  if (nom === undefined || nom.trim() === '') {
    return coupes.length === 0 ? 'Aucun connecteur coupé dans cette session.' : `Connecteurs coupés : ${coupes.join(', ')}.`;
  }
  const cible = coupes.find((c) => c === nom || c.toLowerCase().endsWith(nom.trim().toLowerCase()));
  if (cible === undefined) {
    return `« ${nom} » n'est pas coupé. Connecteurs coupés : ${coupes.length === 0 ? 'aucun' : coupes.join(', ')}.`;
  }
  const erreur = await a.activer(cible);
  return erreur === null
    ? `Connecteur « ${cible} » réactivé : ses outils arrivent (cherche-les avec ToolSearch).`
    : `Réactivation impossible : ${erreur}`;
}

export function serveurConnecteurs(a: ActionsConnecteurs): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: NOM_SERVEUR_CONNECTEURS,
    version: '1.0.0',
    tools: [
      tool(
        'connecteur_activer',
        DESCRIPTION,
        { nom: z.string().max(200).optional().describe('Nom du connecteur, ex. « claude.ai Gmail » ou « Gmail »') },
        async (args) => texte(await repondre(a, args.nom)),
        { searchHint: 'connecteur activer réactiver gmail drive shopify notion calendar mcp outil manquant coupé' },
      ),
    ],
  });
}
