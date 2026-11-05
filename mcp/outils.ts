// Responsabilité : les outils MCP « quart_* » — ouvrir et piloter des sessions Claude Code sur n'importe quelle
// machine du parc, à travers le relais (la session vit dans tmux sur sa machine, visible dans Quart partout).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ClientRelais } from './client-relais.ts';
import { couper, ligneSession, texteFil, texteParc, trouverProjet } from './format.ts';

type Resultat = { content: { type: 'text'; text: string }[]; isError?: boolean };
export type Journal = (message: string, erreur: unknown) => void;

const LIGNES_FIL_MAX = 80;
const Session = z.string().describe('id de session Quart (voir quart_parc)');

async function proteger(nom: string, journal: Journal, f: () => Promise<string>): Promise<Resultat> {
  try {
    return { content: [{ type: 'text', text: await f() }] };
  } catch (e) {
    journal(`échec de ${nom}`, e);
    return { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

export function enregistrerOutils(serveur: McpServer, relais: ClientRelais, journal: Journal): void {
  enregistrerParc(serveur, relais, journal);
  enregistrerOuverture(serveur, relais, journal);
  enregistrerFil(serveur, relais, journal);
  enregistrerMessages(serveur, relais, journal);
  enregistrerPilotage(serveur, relais, journal);
}

function enregistrerParc(serveur: McpServer, relais: ClientRelais, journal: Journal): void {
  serveur.registerTool(
    'quart_parc',
    {
      description: 'Machines du parc (en ligne ou non) et sessions Claude Code vivantes, avec leur statut.',
      inputSchema: { toutes: z.boolean().optional().describe('inclure les sessions fermées/terminées') },
    },
    ({ toutes }) => proteger('quart_parc', journal, async () => texteParc(await relais.etat(), toutes ?? false)),
  );
  serveur.registerTool(
    'quart_projets',
    {
      description: 'Projets ouvrables sur une machine (dossiers sous ses racines, ex. /mnt/projects sur la tour).',
      inputSchema: { machine: z.string() },
    },
    ({ machine }) =>
      proteger('quart_projets', journal, async () => {
        const p = await relais.projets(machine);
        return p.length ? p.map((x) => `- ${x.nom} : ${x.chemin}`).join('\n') : `(aucun projet sur ${machine})`;
      }),
  );
  serveur.registerTool(
    'quart_reveiller',
    {
      description: 'Réveille une machine hors ligne (Wake-on-LAN, ~40 s avant qu’elle soit en ligne). Le dire à Chris.',
      inputSchema: { machine: z.string() },
    },
    ({ machine }) =>
      proteger('quart_reveiller', journal, async () => {
        await relais.reveiller(machine);
        return `Réveil envoyé à ${machine} : vérifier avec quart_parc d’ici ~40 s.`;
      }),
  );
}

const SchemaOuverture = {
  machine: z.string().describe('id de machine (quart_parc) : tour, portable, pi, vps…'),
  projet: z.string().describe('nom du dossier projet (quart_projets) ou chemin absolu sur la machine'),
  message: z.string().min(1).describe('premier message envoyé à la session : la tâche complète'),
  titre: z.string().max(120).optional(),
  objectif: z.string().optional().describe("critère de fin : la session s'arrête quand il est atteint"),
  autonomie: z.boolean().optional().describe('relance automatique jusqu’à l’objectif (défaut : oui)'),
  modele: z.string().optional(),
  compte: z.string().optional().describe('compte Claude de la machine (défaut : principal)'),
};

function enregistrerOuverture(serveur: McpServer, relais: ClientRelais, journal: Journal): void {
  serveur.registerTool(
    'quart_ouvrir',
    {
      description:
        'Ouvre une VRAIE session Claude Code (TUI dans tmux, mode bypass) sur une machine du parc, dans un projet, ' +
        'avec un premier message. Elle tourne sur cette machine, survit à ta session, et se suit/pilote depuis ' +
        "l'app Quart (bureau, web, iPhone) ou avec quart_fil / quart_envoyer.",
      inputSchema: SchemaOuverture,
    },
    (a) =>
      proteger('quart_ouvrir', journal, async () => {
        const projet = trouverProjet(a.machine, a.projet, await relais.projets(a.machine));
        if (typeof projet === 'string') throw new Error(projet);
        const s = await relais.ouvrir({
          machine: a.machine,
          projet,
          message: a.message,
          ...(a.titre ? { titre: a.titre } : {}),
          ...(a.objectif ? { objectif: a.objectif } : {}),
          ...(a.autonomie === undefined ? {} : { autonomie: a.autonomie }),
          ...(a.modele ? { modele: a.modele } : {}),
          ...(a.compte ? { compte: a.compte } : {}),
        });
        const attache = s.tmux
          ? `\nAttacher dans un terminal : ssh -t ${s.machine} "tmux -L claude -u attach -t '=${s.tmux}'"`
          : '';
        return `Session ouverte.\n${ligneSession(s)}\nVisible dans Quart (bureau, web, iPhone).${attache}`;
      }),
  );
}

function enregistrerFil(serveur: McpServer, relais: ClientRelais, journal: Journal): void {
  serveur.registerTool(
    'quart_fil',
    {
      description:
        "Fil d'une session (messages, réponses de Claude, étapes, questions, erreurs). Sans `apres` : la fin du fil. " +
        'Avec `apres` (= `dernier` du précédent appel) et `attendre_s` : attend du nouveau jusqu’à 30 s.',
      inputSchema: {
        session: Session,
        apres: z.number().int().min(0).optional(),
        attendre_s: z.number().int().min(0).max(30).optional(),
        detail: z.boolean().optional().describe('inclure chaque appel d’outil'),
      },
    },
    ({ session, apres, attendre_s, detail }) =>
      proteger('quart_fil', journal, async () => {
        const evts = await relais.evenements(session, apres ?? null, attendre_s ?? 0);
        const { texte, dernier } = texteFil(evts, detail ?? false);
        const lignes = texte.split('\n');
        const coupe = lignes.length > LIGNES_FIL_MAX ? ['…', ...lignes.slice(-LIGNES_FIL_MAX)] : lignes;
        const etat = (await relais.etat()).sessions.find((s) => s.id === session);
        const statut = etat ? `\n\nÉtat : ${ligneSession(etat).slice(2)}` : '';
        return `${coupe.join('\n')}${statut}\n(dernier = ${dernier || (apres ?? 0)})`;
      }),
  );
}

function enregistrerMessages(serveur: McpServer, relais: ClientRelais, journal: Journal): void {
  serveur.registerTool(
    'quart_repondre',
    {
      description:
        'Répond au dialogue bloquant d’une session (question à choix, permission, plan) : `index` de l’option, ' +
        'ou `texte` libre. Le dialogue en attente apparaît dans quart_parc / quart_fil.',
      inputSchema: {
        session: Session,
        dialogue: z.string().describe('id du dialogue'),
        index: z.number().int().min(0).optional(),
        texte: z.string().optional(),
      },
    },
    ({ session, dialogue, index, texte }) =>
      proteger('quart_repondre', journal, async () => {
        await relais.repondre(session, {
          id: dialogue,
          ...(index === undefined ? {} : { index }),
          ...(texte ? { texte } : {}),
        });
        return `Réponse transmise à ${session}.`;
      }),
  );
}

function enregistrerPilotage(serveur: McpServer, relais: ClientRelais, journal: Journal): void {
  serveur.registerTool(
    'quart_envoyer',
    {
      description: 'Envoie un message à une session (collé dans son TUI, comme tapé au clavier).',
      inputSchema: { session: Session, texte: z.string().min(1) },
    },
    ({ session, texte }) =>
      proteger('quart_envoyer', journal, async () => {
        await relais.envoyer(session, texte);
        return `Envoyé à ${session} : « ${couper(texte, 120)} »`;
      }),
  );
  serveur.registerTool(
    'quart_piloter',
    {
      description:
        'Pilote une session : interrompre (Échap), compacter (/compact), fermer (quitte claude et tmux), ' +
        'reprendre (relance une session fermée avec --resume).',
      inputSchema: { session: Session, action: z.enum(['interrompre', 'compacter', 'fermer', 'reprendre']) },
    },
    ({ session, action }) =>
      proteger('quart_piloter', journal, async () => {
        await relais.action(session, action);
        return `${action} : demandé pour ${session}.`;
      }),
  );
}
