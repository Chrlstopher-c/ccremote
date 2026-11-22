// Responsabilité : banc d'essai de la fédération — un aiguilleur réel sur 127.0.0.1 (annuaire en mémoire), des nœuds
// avec leur registre en mémoire, un pont factice qui consigne ce qu'on lui demande, et l'observation des charges.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import pino from 'pino';
import { PlafondEchecs } from '../acces/plafond.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { Annuaire } from '../aiguilleur/annuaire.ts';
import { ouvrirAnnuaire } from '../aiguilleur/annuaire-base.ts';
import { type Aiguilleur, creerAiguilleur } from '../aiguilleur/aiguilleur.ts';
import { executerCommande } from '../aiguilleur/commande.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { Federation, type OptionsFederation } from './federation.ts';
import type { GesteLocal, PontFederation } from './echanges.ts';

const journal = pino({ enabled: false });
export const MAJ = '2026-11-22T10:00:00.000Z';

export interface Monte {
  readonly url: string;
  readonly annuaire: Annuaire;
  readonly aiguilleur: Aiguilleur;
  readonly serveur: ReturnType<typeof Bun.serve>;
}

export interface Appels {
  readonly ecrire: [string, string][];
  readonly interrompre: string[];
  readonly ouvrir: { chemin: string; message: string }[];
  readonly gestes: GesteLocal[];
}

export interface Noeud {
  readonly nom: string;
  readonly registre: Registre;
  readonly diffusion: Diffusion;
  readonly base: Database;
  readonly federation: Federation;
  readonly appels: Appels;
  readonly charges: string[];
}

export function monterAiguilleur(): Monte {
  const db = ouvrirAnnuaire(':memory:');
  const annuaire = new Annuaire(db);
  const plafond = new PlafondEchecs(join(mkdtempSync(join(tmpdir(), 'fede-plafond-')), 'echecs.json'), journal);
  const aiguilleur = creerAiguilleur({ annuaire, journal, plafond });
  const serveur = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: aiguilleur.fetch,
    websocket: aiguilleur.websocket,
  });
  return { url: `http://127.0.0.1:${serveur.port}`, annuaire, aiguilleur, serveur };
}

/** Un code d'appairage pour un propriétaire, émis par la commande locale de l'aiguilleur. */
export function codeAppairage(monte: Monte, proprietaire: string): string {
  return executerCommande(['appairer', proprietaire], monte.annuaire).split('\n')[0] ?? '';
}

/** Pont factice : consigne ce qu'un nœud demande au relais local, et répond comme le relais le ferait. */
function pontFactice(appels: Appels): PontFederation {
  return {
    ouvrir: async (d) => {
      appels.ouvrir.push({ chemin: d.projet.chemin, message: d.message });
      return Response.json({ id: `ouverte-${d.projet.machine}` });
    },
    envoyer: async (s, t) => {
      appels.ecrire.push([s, t]);
      return Response.json({});
    },
    interrompre: async (s) => {
      appels.interrompre.push(s);
      return Response.json({});
    },
    geste: async (g) => {
      appels.gestes.push(g);
      if (g.geste === 'ouvrir') return Response.json(ficheDe('ouverte-par-geste', 'tour', 'Neuve'), { status: 201 });
      return Response.json({ geste: g.geste, session: g.session ?? null });
    },
  };
}

export function creerNoeud(nom: string, options: Partial<OptionsFederation> = {}): Noeud {
  const base = ouvrirBase(':memory:');
  const registre = new Registre(base, journal);
  const diffusion = new Diffusion();
  const appels: Appels = { ecrire: [], interrompre: [], ouvrir: [], gestes: [] };
  const charges: string[] = [];
  const pont = pontFactice(appels);
  const dossierSecrets = mkdtempSync(join(tmpdir(), `fede-${nom}-`));
  const federation = new Federation({
    registre,
    diffusion,
    dossierSecrets,
    machine: nom,
    pont,
    journal,
    intervallePlanificationMs: 100,
    delaiDemandeMs: 2000,
    observer: (_sens, charge) => charges.push(charge),
    ...options,
  });
  federation.demarrer();
  return { nom, registre, diffusion, base, federation, appels, charges };
}

/** Relie un nœud à l'aiguilleur avec un code neuf du propriétaire. */
export async function relier(noeud: Noeud, monte: Monte, proprietaire: string): Promise<string> {
  const code = codeAppairage(monte, proprietaire);
  const r = await noeud.federation.rejoindreAiguilleur({ url: monte.url, code, nom: noeud.nom });
  if (!r.ok) throw new Error(`rejoindre : ${r.raison}`);
  return r.valeur.id;
}

export function ficheDe(id: string, machine: string, titre: string): ResumeSession {
  return {
    id,
    machine,
    projet: { machine, chemin: `/projets/${id}`, nom: id },
    cwd: `/projets/${id}`,
    titre,
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
  } as ResumeSession;
}

/** Attend qu'une condition (éventuellement asynchrone) devienne vraie ; échoue au bout de `ms`. */
export async function attendre(condition: () => boolean | Promise<boolean>, ms = 4000): Promise<void> {
  const fin = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > fin) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 15));
  }
}
