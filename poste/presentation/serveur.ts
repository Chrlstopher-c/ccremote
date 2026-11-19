// Responsabilité : le serveur MCP `lanterne` en processus, ajouté à chaque session SDK — ses trois outils et les mots
// que l'agent lit pour savoir quand s'en servir. Les appels passent par les mêmes gardes que le reste (voir outils.ts).
import { createSdkMcpServer, type McpSdkServerConfigWithInstance, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { ModeFichier } from '../../commun/presentation.ts';
import { afficherWidget } from './widget.ts';
import { envoyerFichier, publierArtefact } from './envoi.ts';
import type { ContexteOutils, Resultat } from './outils.ts';
import * as machines from './machines-outils.ts';

export const NOM_SERVEUR = 'lanterne';

const DESCRIPTION_ENVOYER =
  'Présenter un fichier à Chris dans le fil : image, PDF, page HTML ou Markdown, texte ou code, pris sur le poste ' +
  '(chemin absolu, ou relatif au dossier de la session). À utiliser quand Chris doit voir ou récupérer ce que tu as ' +
  'produit (capture, rapport, graphique, export) plutôt que de le décrire. Mode « afficher » (défaut) pour l’aperçu, ' +
  '« joindre » pour un fichier à télécharger. 5 Mo au plus.';

const DESCRIPTION_ARTEFACT =
  'Publier une page HTML autonome que Chris ouvre dans le lecteur d’artefacts (tableau de bord, mini-application, ' +
  'rapport interactif). Donner soit `chemin` (un fichier .html), soit `contenu` (le HTML complet). Pour mettre à jour ' +
  'une page déjà publiée, passer son `id` renvoyé par l’appel précédent : une nouvelle version est ajoutée. Pour un ' +
  'simple fichier, utiliser envoyer_fichier ; pour un petit schéma, afficher_widget.';

const DESCRIPTION_WIDGET =
  'Afficher un petit visuel en place dans le fil : un SVG (schéma, icône, graphique simple) ou un fragment HTML court ' +
  '(carte, tableau stylé) pour illustrer une réponse. 300 Ko au plus. Pour une page complète réutilisable, préférer ' +
  'publier_artefact.';

interface ResultatOutil {
  [cle: string]: unknown;
  readonly content: { readonly type: 'text'; readonly text: string }[];
  readonly isError?: boolean;
}

function enResultat(r: Resultat): ResultatOutil {
  return { content: [{ type: 'text', text: r.texte }], ...(r.erreur ? { isError: true } : {}) };
}

/** Les outils `machines` n’existent que si le relais est joignable (API et jeton configurés). */
function outilsMachines(c: ContexteOutils) {
  if (!c.api) return [];
  const api = c.api;
  return [
    tool('lister_machines', 'Lister les machines configurées (connexion SSH) de Chris, avec l’état de leur poste.', {}, async () =>
      enResultat(await machines.listerMachines(api)),
    ),
    tool('tester_machine', 'Tester une machine : SSH, Claude Code, tmux, bun, poste connecté.', { id: z.string().min(1).max(40) }, async (a) =>
      enResultat(await machines.testerMachine(api, a.id)),
    ),
    tool(
      'ajouter_machine',
      'Ajouter une machine configurée (SSH, joignable par le VPN du parc). La clé est un chemin de fichier local au relais.',
      {
        id: z.string().min(1).max(40),
        description: z.string().max(200).optional(),
        hote: z.string().min(1).max(253),
        port: z.number().int().min(1).max(65535).optional(),
        utilisateur: z.string().min(1).max(32),
        cle: z.string().min(1).max(1000),
        dossier: z.string().min(1).max(1000).optional(),
      },
      async (a) => enResultat(await machines.ajouterMachine(api, a)),
    ),
    tool(
      'modifier_machine',
      'Modifier une machine configurée. Chris doit confirmer dans l’appli avant toute modification.',
      { id: z.string().min(1).max(40), modif: z.record(z.string(), z.unknown()) },
      async (a) => enResultat(await machines.modifierMachine(api, a.id, a.modif, c.journal)),
    ),
    tool(
      'supprimer_machine',
      'Supprimer la configuration d’une machine. Chris doit confirmer dans l’appli ; sans accord, rien n’est supprimé.',
      { id: z.string().min(1).max(40) },
      async (a) => enResultat(await machines.supprimerMachine(api, a.id, c.journal)),
    ),
  ];
}

export function serveurPresentation(c: ContexteOutils): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: NOM_SERVEUR,
    version: '1.0.0',
    tools: [
      tool(
        'envoyer_fichier',
        DESCRIPTION_ENVOYER,
        {
          chemin: z.string().min(1).max(4096),
          legende: z.string().max(500).optional(),
          mode: ModeFichier.optional(),
        },
        async (args) => enResultat(envoyerFichier(c, args)),
      ),
      tool(
        'publier_artefact',
        DESCRIPTION_ARTEFACT,
        {
          titre: z.string().min(1).max(120),
          chemin: z.string().min(1).max(4096).optional(),
          contenu: z.string().min(1).optional(),
          id: z.string().max(40).optional(),
        },
        async (args) => enResultat(publierArtefact(c, args)),
      ),
      tool(
        'afficher_widget',
        DESCRIPTION_WIDGET,
        { titre: z.string().min(1).max(120), code: z.string().min(1), type: z.enum(['svg', 'html']) },
        async (args) => enResultat(afficherWidget(c, args)),
      ),
      ...outilsMachines(c),
    ],
  });
}
