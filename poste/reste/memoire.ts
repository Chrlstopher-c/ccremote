// Responsabilité : la mémoire Hippocampe lue depuis le poste, en lecture seule. Le serveur MCP est pris dans la
// configuration Claude de la machine (`mcpServers`, type http) ; trois outils seulement sont appelables.
// Les en-têtes du serveur (jetons) ne sont ni journalisés ni renvoyés.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { OutilMemoire, ReponseMemoire } from '../../commun/reste.ts';

export const DELAI_MEMOIRE_MS = 15_000;
const VERSION_PROTOCOLE = '2025-06-18';
const NOM_PREFERE = 'semantic-memory';
const JOURS_DEFAUT = 7;
const MAX_TEXTE = 200_000;

export interface DemandeMemoire {
  readonly outil: OutilMemoire;
  readonly projet?: string;
  readonly jours?: number;
}

interface ServeurHttp {
  readonly url: string;
  readonly entetes: Record<string, string>;
}

interface AppelOutil {
  readonly nom: string;
  readonly arguments: Record<string, unknown>;
}

type Objet = Record<string, unknown>;

/** Erreur dont le message est sûr à rendre à Chris (jamais d'URL, d'en-tête ni de corps de réponse). */
class ErreurMemoire extends Error {}

/** Le fichier de configuration Claude : `LANTERNE_CLAUDE_JSON` au banc, sinon `~/.claude.json`. */
export function fichierClaudeJson(env: NodeJS.ProcessEnv = process.env): string {
  return env['LANTERNE_CLAUDE_JSON'] || join(homedir(), '.claude.json');
}

/** La réponse Hippocampe pour une demande d'outil de la liste blanche. Aucune écriture, aucun autre outil. */
export async function lireMemoire(
  demande: DemandeMemoire,
  fichier: string,
  journal: Logger,
  delaiMs = DELAI_MEMOIRE_MS,
): Promise<ReponseMemoire> {
  const serveur = serveurMemoire(fichier, journal);
  if (!('url' in serveur)) return serveur;
  const appel = appelDe(demande);
  if (typeof appel === 'string') return { etat: 'erreur', raison: appel };
  try {
    const texte = await appelerOutil(serveur, appel, delaiMs);
    return { etat: 'ok', outil: demande.outil, texte };
  } catch (erreur) {
    journal.warn({ outil: demande.outil, code: codeErreur(erreur) }, 'mémoire : appel impossible');
    return { etat: 'erreur', raison: erreur instanceof ErreurMemoire ? erreur.message : 'Hippocampe injoignable' };
  }
}

// La liste blanche : le nom d'outil ne vient jamais de Chris, seulement de cette correspondance.
function appelDe(d: DemandeMemoire): AppelOutil | string {
  if (d.outil === 'fiche') {
    return d.projet ? { nom: 'hippo_fiche', arguments: { sujet: d.projet } } : 'projet attendu pour la fiche';
  }
  if (d.outil === 'recap') return { nom: 'hippo_recap', arguments: { jours: d.jours ?? JOURS_DEFAUT } };
  return { nom: 'project_list', arguments: {} };
}

// Le serveur à appeler, ou la réponse « absente » / « erreur » qui le remplace.
function serveurMemoire(fichier: string, journal: Logger): ServeurHttp | ReponseMemoire {
  let brut: unknown;
  try {
    brut = JSON.parse(readFileSync(fichier, 'utf8'));
  } catch (erreur) {
    if (codeErreur(erreur) === 'ENOENT') return { etat: 'absente', raison: 'configuration Claude introuvable' };
    journal.warn({ code: codeErreur(erreur) }, 'configuration Claude illisible');
    return { etat: 'erreur', raison: 'configuration Claude illisible' };
  }
  const serveurs = enObjet(enObjet(brut)?.['mcpServers']);
  const choisi = serveurs ? choisirServeur(serveurs) : null;
  if (!choisi) return { etat: 'absente', raison: 'aucun serveur Hippocampe http configuré' };
  return choisi;
}

// Le serveur nommé `semantic-memory`, sinon le premier serveur http dont le nom évoque la mémoire.
function choisirServeur(serveurs: Objet): ServeurHttp | null {
  const httpSeuls = Object.entries(serveurs).flatMap(([nom, v]) => {
    const s = serveurHttp(v);
    return s ? [{ nom, s }] : [];
  });
  const exact = httpSeuls.find((x) => x.nom === NOM_PREFERE);
  return (exact ?? httpSeuls.find((x) => /hippo|memory/i.test(x.nom)))?.s ?? null;
}

function serveurHttp(v: unknown): ServeurHttp | null {
  const o = enObjet(v);
  if (!o || o['type'] !== 'http' || typeof o['url'] !== 'string') return null;
  if (!['http:', 'https:'].includes(urlSure(o['url']))) return null;
  const entetes: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(enObjet(o['headers']) ?? {})) {
    if (typeof valeur === 'string') entetes[cle] = valeur;
  }
  return { url: o['url'], entetes };
}

// Protocole de l'URL, ou chaîne vide si elle n'est pas une URL (serveur écarté).
function urlSure(brut: string): string {
  try {
    return new URL(brut).protocol;
  } catch {
    return '';
  }
}

async function appelerOutil(serveur: ServeurHttp, appel: AppelOutil, delaiMs: number): Promise<string> {
  const controle = new AbortController();
  let depasse = false;
  const minuterie = setTimeout(() => {
    depasse = true;
    controle.abort();
  }, delaiMs);
  try {
    const client = new ClientMcp(serveur.url, serveur.entetes, controle.signal);
    await client.requete('initialize', {
      protocolVersion: VERSION_PROTOCOLE,
      capabilities: {},
      clientInfo: { name: 'lanterne', version: '1' },
    });
    await client.notifier('notifications/initialized');
    return texteDuResultat(await client.requete('tools/call', { name: appel.nom, arguments: appel.arguments }));
  } catch (erreur) {
    if (depasse) throw new ErreurMemoire('délai dépassé');
    throw erreur;
  } finally {
    clearTimeout(minuterie);
  }
}

/** Client MCP HTTP streamable minimal : initialisation, notification, un appel d'outil par requête. */
class ClientMcp {
  private session: string | null = null;
  private version: string | null = null;
  private suivant = 1;

  constructor(
    private readonly url: string,
    private readonly entetes: Record<string, string>,
    private readonly signal: AbortSignal,
  ) {}

  async requete(methode: string, params: unknown): Promise<unknown> {
    const id = this.suivant++;
    const reponse = await this.envoyer({ jsonrpc: '2.0', id, method: methode, params });
    const message = lireMessage(await reponse.text(), reponse.headers.get('content-type'), id);
    if (methode === 'initialize') this.version = VERSION_PROTOCOLE;
    if ('error' in message) throw new ErreurMemoire('le serveur Hippocampe a refusé la requête');
    return message['result'];
  }

  async notifier(methode: string): Promise<void> {
    await this.envoyer({ jsonrpc: '2.0', method: methode });
  }

  private async envoyer(corps: object): Promise<Response> {
    const entetes: Record<string, string> = {
      ...this.entetes,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    };
    if (this.session) entetes['mcp-session-id'] = this.session;
    if (this.version) entetes['mcp-protocol-version'] = this.version;
    const reponse = await fetch(this.url, {
      method: 'POST',
      headers: entetes,
      body: JSON.stringify(corps),
      signal: this.signal,
    });
    const session = reponse.headers.get('mcp-session-id');
    if (session) this.session = session;
    if (!reponse.ok) throw new ErreurMemoire(`Hippocampe a répondu HTTP ${reponse.status}`);
    return reponse;
  }
}

// La réponse JSON, ou l'événement SSE (lignes `data:`) qui porte l'identifiant attendu.
function lireMessage(texte: string, type: string | null, id: number): Objet {
  const objets: unknown[] = type?.includes('text/event-stream')
    ? texte
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => JSON.parse(l.slice('data:'.length).trim()) as unknown)
    : [JSON.parse(texte) as unknown];
  const trouve = objets.map(enObjet).find((o) => o !== null && o['id'] === id);
  if (!trouve) throw new ErreurMemoire('réponse Hippocampe illisible');
  return trouve;
}

function texteDuResultat(resultat: unknown): string {
  const r = enObjet(resultat);
  if (!r) throw new ErreurMemoire('réponse Hippocampe vide');
  if (r['isError'] === true) throw new ErreurMemoire('Hippocampe a signalé une erreur');
  const blocs: unknown[] = Array.isArray(r['content']) ? r['content'] : [];
  const textes = blocs.flatMap((b) => {
    const o = enObjet(b);
    return o?.['type'] === 'text' && typeof o['text'] === 'string' ? [o['text']] : [];
  });
  return textes.join('\n').slice(0, MAX_TEXTE);
}

function codeErreur(erreur: unknown): string {
  if (typeof erreur === 'object' && erreur !== null && 'code' in erreur) return String(erreur.code);
  return erreur instanceof Error ? erreur.name : 'inconnue';
}

// Valeur JSON déjà lue : le cast ne sert qu'à lire ses champs par clé, après vérification d'objet.
function enObjet(v: unknown): Objet | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Objet) : null;
}
