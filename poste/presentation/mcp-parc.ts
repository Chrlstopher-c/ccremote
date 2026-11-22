// Responsabilité : le serveur MCP `parc` des sessions Claude Code ouvertes hors de Lanterne — machines, sessions, fil,
// envoi, ouverture, réponse et réveil du parc, relayés au relais par le socket du poste (liste blanche côté poste et
// relais). Lancé par Claude Code (`bun run poste/presentation/mcp-parc.ts`) ; sur stdout, seul le protocole MCP ; le
// journal va sur stderr. Garde : une session ne vise jamais elle-même (CCREMOTE_SESSION, posée par Lanterne).
import { homedir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import pino, { type Logger } from 'pino';
import type { z } from 'zod';
import type { ReponseRelais } from '../../commun/modules.ts';
import {
  type OperationParc,
  SCHEMA_PARC_ENVOYER,
  SCHEMA_PARC_FIL,
  SCHEMA_PARC_MACHINES,
  SCHEMA_PARC_OUVRIR,
  SCHEMA_PARC_REPONDRE,
  SCHEMA_PARC_REVEILLER,
  SCHEMA_PARC_SESSIONS,
  SortieFilParc,
  SortieMachinesParc,
  SortieOuvertureParc,
  SortieReveilParc,
  SortieSessionsParc,
} from '../../commun/parc.ts';
import { requeteOutils } from './lien-outils-externe.ts';
import { DESCRIPTIONS_PARC } from './parc-declaration.ts';
import { texteFil, texteMachines, texteOuverture, texteReveil, texteSessions } from './parc-format.ts';
import { cheminSocketOutils } from './socket-outils.ts';

// Posée par Lanterne dans les sessions tmux qu'elle lance : la session ne peut pas se viser elle-même.
export const VAR_SESSION_APPELANTE = 'CCREMOTE_SESSION';
const NOM_SERVEUR = 'parc';
const REFUS_SOI =
  'Refusé : une session ne peut pas viser la session dans laquelle elle tourne. ' +
  'Demander à Chris ou viser une autre session.';

export interface LienParc {
  readonly journal: Logger;
  readonly relais: (quoi: OperationParc, args: unknown) => Promise<ReponseRelais>;
}

interface ResultatMcp {
  [cle: string]: unknown;
  readonly content: { readonly type: 'text'; readonly text: string }[];
  readonly isError?: boolean;
}

function texte(t: string, erreur = false): ResultatMcp {
  return { content: [{ type: 'text' as const, text: t }], ...(erreur ? { isError: true } : {}) };
}

/** Une sortie lue par son schéma, puis rendue en texte ; hors schéma : null. */
function lire<S extends z.ZodType>(schema: S, donnees: unknown, rendre: (valeur: z.infer<S>) => string): string | null {
  const lue = schema.safeParse(donnees);
  return lue.success ? rendre(lue.data) : null;
}

/** L'appel au relais : un échec ou une réponse illisible devient un texte d'erreur, jamais une exception. */
async function appeler(
  lien: LienParc,
  quoi: OperationParc,
  args: unknown,
  rendre: (donnees: unknown) => string | null,
): Promise<ResultatMcp> {
  let r: ReponseRelais;
  try {
    r = await lien.relais(quoi, args);
  } catch (erreur) {
    lien.journal.error({ err: erreur, outil: quoi }, 'appel du parc en échec');
    return texte('Échec : appel du parc impossible', true);
  }
  lien.journal.info({ outil: quoi, ok: r.ok }, 'outil du parc');
  if (!r.ok) return texte(`Échec : ${r.erreur ?? 'erreur inconnue'}`, true);
  const sortie = rendre(r.donnees);
  return sortie === null ? texte('Réponse du relais illisible.', true) : texte(sortie);
}

/** Refus, sans rien envoyer, si l'opération viserait la session appelante elle-même. */
function refusSoi(lien: LienParc, appelante: string | null, cible: string): ResultatMcp | null {
  if (appelante === null || appelante !== cible) return null;
  lien.journal.warn({ cible }, 'outil du parc : session visant elle-même refusée');
  return texte(REFUS_SOI, true);
}

function enregistrerLecture(serveur: McpServer, lien: LienParc): void {
  serveur.registerTool(
    'parc_machines',
    { description: DESCRIPTIONS_PARC.parc_machines, inputSchema: SCHEMA_PARC_MACHINES },
    () => appeler(lien, 'parc_machines', {}, (d) => lire(SortieMachinesParc, d, texteMachines)),
  );
  serveur.registerTool(
    'parc_sessions',
    { description: DESCRIPTIONS_PARC.parc_sessions, inputSchema: SCHEMA_PARC_SESSIONS },
    (a) => appeler(lien, 'parc_sessions', a, (d) => lire(SortieSessionsParc, d, texteSessions)),
  );
  serveur.registerTool(
    'parc_fil',
    { description: DESCRIPTIONS_PARC.parc_fil, inputSchema: SCHEMA_PARC_FIL },
    (a) => appeler(lien, 'parc_fil', a, (d) => lire(SortieFilParc, d, texteFil)),
  );
}

function enregistrerAction(serveur: McpServer, lien: LienParc, appelante: string | null): void {
  serveur.registerTool(
    'parc_reveiller',
    { description: DESCRIPTIONS_PARC.parc_reveiller, inputSchema: SCHEMA_PARC_REVEILLER },
    (a) => appeler(lien, 'parc_reveiller', a, (d) => lire(SortieReveilParc, d, (s) => texteReveil(a.machine, s.par))),
  );
  serveur.registerTool(
    'parc_envoyer',
    { description: DESCRIPTIONS_PARC.parc_envoyer, inputSchema: SCHEMA_PARC_ENVOYER },
    async (a) =>
      refusSoi(lien, appelante, a.session) ??
      appeler(lien, 'parc_envoyer', a, () => `Message envoyé à ${a.session}.`),
  );
  serveur.registerTool(
    'parc_ouvrir',
    { description: DESCRIPTIONS_PARC.parc_ouvrir, inputSchema: SCHEMA_PARC_OUVRIR },
    (a) => appeler(lien, 'parc_ouvrir', a, (d) => lire(SortieOuvertureParc, d, texteOuverture)),
  );
  serveur.registerTool(
    'parc_repondre',
    { description: DESCRIPTIONS_PARC.parc_repondre, inputSchema: SCHEMA_PARC_REPONDRE },
    async (a) =>
      refusSoi(lien, appelante, a.session) ??
      appeler(lien, 'parc_repondre', a, () => `Réponse transmise à ${a.session}.`),
  );
}

/** Le serveur : les sept outils du parc. Pas de liste vide dans une session pilotée : le parc n'a rien de pilotée. */
export function creerServeurParc(lien: LienParc, appelante: string | null): McpServer {
  const serveur = new McpServer({ name: NOM_SERVEUR, version: '1.0.0' }, { capabilities: { tools: {} } });
  enregistrerLecture(serveur, lien);
  enregistrerAction(serveur, lien, appelante);
  return serveur;
}

function journalParc(): Logger {
  return pino(
    { name: 'lanterne-parc', level: process.env['CCREMOTE_NIVEAU_LOG'] ?? 'info' },
    pino.destination({ dest: 2, sync: true }),
  );
}

async function principal(): Promise<void> {
  const journal = journalParc();
  const donnees = join(homedir(), '.local', 'share', 'ccremote', 'poste');
  const chemin = cheminSocketOutils(process.env, process.getuid?.(), donnees);
  const lien: LienParc = { journal, relais: (quoi, args) => requeteOutils(chemin, quoi, args) };
  const appelante = process.env[VAR_SESSION_APPELANTE] || null;
  await creerServeurParc(lien, appelante).connect(new StdioServerTransport());
  journal.info({ chemin, appelante: appelante !== null }, 'outils du parc prêts');
}

if (import.meta.main) await principal();
