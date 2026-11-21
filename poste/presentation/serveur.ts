// Responsabilité : le serveur MCP `lanterne` en processus, ajouté à chaque session SDK — ses trois outils et les mots
// que l'agent lit pour savoir quand s'en servir. Les appels passent par les mêmes gardes que le reste (voir outils.ts).
import { createSdkMcpServer, type McpSdkServerConfigWithInstance, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { ModeFichier } from '../../commun/presentation.ts';
import { DonneesModule, REGEX_ID_MODULE, REGEX_NOM_OUTIL } from '../../commun/modules.ts';
import { afficherWidget } from './widget.ts';
import { envoyerFichier, publierArtefact } from './envoi.ts';
import type { ContexteOutils, Resultat } from './outils.ts';
import * as machines from './machines-outils.ts';
import * as modules from './modules-outils.ts';

export const NOM_SERVEUR = 'lanterne';

const DESCRIPTION_ENVOYER =
  'Joindre, envoyer ou présenter un fichier à Chris dans le fil (« joins X à la discussion », « envoie-moi X », ' +
  '« montre-moi X ») : image, PDF, page HTML ou Markdown, texte ou code, pris sur le poste (chemin absolu, ou relatif ' +
  'au dossier de la session). Mode « joindre » : fichier à télécharger, carte dans le fil ; « afficher » (défaut) : ' +
  'aperçu. Ne jamais répondre qu’on ne peut pas joindre un fichier sans essayer cet outil. 5 Mo au plus.';

const DESCRIPTION_ARTEFACT =
  'Publier une page HTML autonome que Chris ouvre dans le lecteur d’artefacts (tableau de bord, mini-application, ' +
  'rapport interactif). Donner soit `chemin` (un fichier .html), soit `contenu` (le HTML complet). Pour mettre à jour ' +
  'une page déjà publiée, passer son `id` renvoyé par l’appel précédent : une nouvelle version est ajoutée. Pour un ' +
  'simple fichier, utiliser envoyer_fichier ; pour un petit schéma, afficher_widget.';

const DESCRIPTION_WIDGET =
  'Afficher un petit visuel en place dans le fil : un SVG (schéma, icône, graphique simple) ou un fragment HTML court ' +
  '(carte, tableau stylé) pour illustrer une réponse. 300 Ko au plus. Pour une page complète réutilisable, préférer ' +
  'publier_artefact.';

const DESCRIPTION_MODULES_LISTER =
  'Lister les outils et les intégrations des modules Lanterne (extensions de l’appli de Chris : carte, etc.). ' +
  'À lire avant d’appeler un outil de module ou d’afficher une intégration.';

const DESCRIPTION_MODULE_APPELER =
  'Appeler un outil d’un module Lanterne, tel que listé par modules_lister. Le résultat revient en texte. ' +
  'Échoue si aucune appli Lanterne n’est ouverte ou si le module n’y est pas actif.';

const DESCRIPTION_MODULE_AFFICHER =
  'Afficher une intégration de module dans le fil (ex. des lieux sur une carte), telle que listée par ' +
  'modules_lister, avec ses données (objet JSON, 64 Ko au plus).';

interface ResultatOutil {
  [cle: string]: unknown;
  readonly content: { readonly type: 'text'; readonly text: string }[];
  readonly isError?: boolean;
}

function enResultat(r: Resultat): ResultatOutil {
  return { content: [{ type: 'text', text: r.texte }], ...(r.erreur ? { isError: true } : {}) };
}

const DESCRIPTION_RENOMMER =
  'Renommer cette conversation dans Lanterne. À utiliser UNIQUEMENT quand l’utilisateur le demande explicitement ' +
  '(« renomme la conversation », « appelle cette session… ») : jamais de ta propre initiative, jamais pour résumer ' +
  'ton travail. Le titre est court (60 caractères au plus), sans guillemets ni ponctuation finale.';

/** Titre demandé, nettoyé : espaces réduits, guillemets et ponctuation finale retirés, 60 caractères au plus. */
export function titreNettoye(brut: string): string {
  const net = brut.replace(/\s+/g, ' ').trim().replace(/^["«»“”']+|["«»“”'.!?…]+$/g, '').trim();
  return Array.from(net).slice(0, 60).join('');
}

/** L'outil `renommer_conversation` : exposé seulement quand la session sait se renommer. */
export function outilRenommer(c: ContexteOutils) {
  const renommer = c.renommer;
  if (!renommer) return [];
  return [
    tool(
      'renommer_conversation',
      DESCRIPTION_RENOMMER,
      { titre: z.string().min(1).max(200) },
      async (args) => {
        const titre = titreNettoye(args.titre);
        if (titre === '') return enResultat({ texte: 'titre vide : rien n’a été changé', erreur: true });
        renommer(titre);
        return enResultat({ texte: `Conversation renommée : « ${titre} ».`, erreur: false });
      },
      { searchHint: 'renommer conversation session titre nom' },
    ),
  ];
}

/** Les outils `modules` : toujours exposés ; lister et appeler passent par le lien au relais, afficher reste local. */
export function outilsModules(c: ContexteOutils) {
  const afficher = tool(
    'module_afficher',
    DESCRIPTION_MODULE_AFFICHER,
    {
      module: z.string().regex(REGEX_ID_MODULE),
      integration: z.string().regex(REGEX_ID_MODULE),
      donnees: DonneesModule,
      titre: z.string().min(1).max(120).optional(),
    },
    async (a) => enResultat(modules.afficherModule(c, a)),
  );
  return [
    tool('modules_lister', DESCRIPTION_MODULES_LISTER, {}, async () => enResultat(await modules.listerModules(c))),
    tool(
      'module_appeler',
      DESCRIPTION_MODULE_APPELER,
      {
        module: z.string().regex(REGEX_ID_MODULE),
        outil: z.string().regex(REGEX_NOM_OUTIL),
        arguments: DonneesModule.optional(),
      },
      async (a) => enResultat(await modules.appelerModule(c, a)),
    ),
    afficher,
  ];
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

// `alwaysLoad` : les outils de présentation sont dans le prompt dès le premier tour, jamais différés derrière ToolSearch
// (sinon l'agent répond sans les chercher). `searchHint` sert si la recherche d'outils reste active.
export function serveurPresentation(c: ContexteOutils): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: NOM_SERVEUR,
    version: '1.0.0',
    alwaysLoad: true,
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
        { searchHint: 'joindre envoyer présenter fichier partager montre-moi télécharger pièce jointe' },
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
      ...outilsModules(c),
      ...outilRenommer(c),
    ],
  });
}
