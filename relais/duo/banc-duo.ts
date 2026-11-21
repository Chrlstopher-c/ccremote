// Responsabilité : banc d'essai du mode duo (étape 2) — deux relais en mémoire reliés par leur lien WebSocket réel,
// un poste factice qui répond à chaque commande, et les sessions réelles (ApiSessions) côté propriétaire.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { ApiSessions } from '../clients/api-sessions.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { type DonneesPoste, Postes } from '../parc/postes.ts';
import { Duo } from './duo.ts';

const journal = pino({ enabled: false });
export const MAJ = '2026-11-21T10:00:00.000Z';

export type Commande = Record<string, unknown>;

export interface Banc {
  readonly nom: string;
  readonly registre: Registre;
  readonly diffusion: Diffusion;
  readonly postes: Postes;
  readonly poste: ServerWebSocket<DonneesPoste>;
  readonly duo: Duo;
  readonly sessions: ApiSessions;
  readonly commandes: Commande[];
  readonly recus: MessageClient[];
  readonly dossier: string;
}

export interface OptionsBanc {
  readonly delaiDemandeMs?: number;
}

export function creerBanc(nom: string, options: OptionsBanc = {}): Banc {
  const base = ouvrirBase(':memory:');
  const registre = new Registre(base, journal);
  const diffusion = new Diffusion();
  const recus: MessageClient[] = [];
  diffusion.ecouter((m) => recus.push(m));
  const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
  const commandes: Commande[] = [];
  // Le poste répond après coup, comme un vrai : un `ouvrir` enregistre d'abord la session qu'il vient de créer.
  const posteFactice = {
    data: { machine: 'tour' },
    send: (brut: string) => repondre(JSON.parse(brut) as Commande),
    close: () => undefined,
  } as unknown as ServerWebSocket<DonneesPoste>;
  function repondre(cmd: Commande): void {
    commandes.push(cmd);
    setTimeout(() => surCommande(cmd), 0);
  }
  function surCommande(cmd: Commande): void {
    if (cmd['kind'] === 'ouvrir') {
      const demande = cmd['demande'] as { sessionId: string; projet: { chemin: string } };
      const fiche = ficheOuverte(demande.sessionId, demande.projet.chemin);
      postes.recu(posteFactice, JSON.stringify({ kind: 'session', session: fiche }));
      postes.recu(posteFactice, JSON.stringify({ kind: 'reponse', id: cmd['id'], ok: true, donnees: fiche }));
      return;
    }
    postes.recu(posteFactice, JSON.stringify({ kind: 'reponse', id: cmd['id'], ok: true, donnees: {} }));
  }
  postes.ouvert(posteFactice);
  const dossier = mkdtempSync(join(tmpdir(), `duo-banc-${nom}-`));
  const duo: Duo = new Duo({
    registre,
    diffusion,
    base,
    utilisateur: nom,
    dossierSecrets: dossier,
    ecoute: '127.0.0.1',
    port: 0,
    journal,
    maintenant: () => Date.parse(MAJ),
    delaiReconnexionMs: 20,
    ...(options.delaiDemandeMs !== undefined ? { delaiDemandeMs: options.delaiDemandeMs } : {}),
    sessions: {
      ouvrir: (d) => sessions.ouvrirAvec(d),
      envoyer: (s, t, p, a) => sessions.envoyerDuPair(s, t, p, a),
      interrompre: (s) => sessions.interrompreDuPair(s),
    },
  });
  const sessions: ApiSessions = new ApiSessions(registre, postes, diffusion, new Set(), journal, duo);
  duo.demarrer();
  return { nom, registre, diffusion, postes, poste: posteFactice, duo, sessions, commandes, recus, dossier };
}

export function ficheOuverte(id: string, chemin: string, mode?: ResumeSession['mode']): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin, nom: 'p' },
    cwd: chemin,
    titre: `Titre ${id}`,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: id,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
    ...(mode ? { mode } : {}),
  };
}

/** Un message du poste (session, événement) comme s'il arrivait de la machine « tour » du relais. */
export function poster(b: Banc, message: object): void {
  b.postes.recu(b.poste, JSON.stringify(message));
}

/** Deux relais reliés : alice (propriétaire de la session) et bob (le pair). */
export async function deuxBancs(options: OptionsBanc = {}): Promise<{ a: Banc; b: Banc }> {
  const a = creerBanc('alice', options);
  const b = creerBanc('bob', options);
  const code = a.duo.codeAppairage();
  if (!code.ok) throw new Error(code.raison);
  const rejoint = await b.duo.rejoindre(`127.0.0.1:${a.duo.portEcoute}`, code.valeur.code);
  if (!rejoint.ok) throw new Error(rejoint.raison);
  await attendre(() => a.duo.etat().etat === 'connecte' && b.duo.etat().etat === 'connecte');
  return { a, b };
}

export async function attendre(condition: () => boolean, ms = 3000): Promise<void> {
  const fin = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > fin) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 10));
  }
}
