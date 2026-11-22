// Responsabilité : banc d'essai du duo par l'aiguilleur (étape 7) — un vrai aiguilleur sur 127.0.0.1, des nœuds (Duo et
// fédération) qui s'y relient, un pont de sessions enregistreur (il consigne ce qu'on lui demande et injecte la session
// créée dans le registre du propriétaire, comme le poste le ferait). Données de test seulement.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { CorpsPartage, EtatDuo } from '../../commun/duo.ts';
import type { PieceJointe } from '../../commun/presentation.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { executerCommande } from '../aiguilleur/commande.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { Federation } from '../federation/federation.ts';
import { attendre, codeAppairage, MAJ, type Monte, monterAiguilleur } from '../federation/banc-federation.ts';
import { type DonneesPoste, Postes } from '../parc/postes.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { Duo, type Resultat } from './duo.ts';
import type { OuvertureChezProprietaire, PontSessions } from './pont-sessions.ts';

const journal = pino({ enabled: false });
export { attendre, MAJ };

/** Ce que le pont de sessions d'un nœud a reçu (ouvertures, écritures au nom du pair). */
export interface Appels {
  readonly ouvrir: OuvertureChezProprietaire[];
  readonly envoyer: { session: string; texte: string; auteur: string }[];
}

/** Ce qu'un nœud de banc possède en mémoire : registre, diffusion, poste factice, pont enregistreur, traces. */
export interface Ressources {
  readonly registre: Registre;
  readonly diffusion: Diffusion;
  readonly postes: Postes;
  readonly poste: ServerWebSocket<DonneesPoste>;
  readonly appels: Appels;
  readonly charges: string[];
  readonly dossiers: string[];
}

export interface Noeud extends Ressources {
  readonly proprietaire: string;
  readonly duo: Duo;
  readonly federation: Federation;
  membre: string;
}

const noeuds: Noeud[] = [];
let monte: Monte | null = null;
let compteur = 0;

/** Démarre un aiguilleur neuf pour le test en cours (annuaire en mémoire). */
export function demarrerAiguilleur(): Monte {
  monte = monterAiguilleur();
  return monte;
}

export function arreterTout(): void {
  for (const n of noeuds.splice(0)) {
    n.duo.arreter();
    n.federation.arreter();
    for (const d of n.dossiers) rmSync(d, { recursive: true, force: true });
  }
  monte?.serveur.stop(true);
  monte = null;
}

function aiguilleur(): Monte {
  if (!monte) throw new Error('aiguilleur non démarré : appeler demarrerAiguilleur()');
  return monte;
}

function pontEnregistreur(postes: Postes, poste: ServerWebSocket<DonneesPoste>, appels: Appels): PontSessions {
  return {
    ouvrir: async (demande) => {
      const id = `s-${++compteur}`;
      appels.ouvrir.push(demande);
      postes.recu(poste, JSON.stringify({ kind: 'session', session: fiche(id, demande.projet.chemin) }));
      return Response.json({ id });
    },
    envoyer: async (session, texte, _pieces: readonly PieceJointe[], auteur) => {
      appels.envoyer.push({ session, texte, auteur });
      return Response.json({});
    },
    interrompre: async () => Response.json({}),
    tracer: async () => Response.json({}),
  };
}

const pontFederationSimule = {
  ouvrir: () => Promise.resolve(Response.json({ erreur: 'sans sessions' }, { status: 409 })),
  envoyer: () => Promise.resolve(Response.json({ erreur: 'sans sessions' }, { status: 409 })),
  interrompre: () => Promise.resolve(Response.json({ erreur: 'sans sessions' }, { status: 409 })),
};

function creerDuoBanc(proprietaire: string, base: Database, r: Ressources, dossier: string): Duo {
  return new Duo({
    registre: r.registre,
    diffusion: r.diffusion,
    base,
    utilisateur: proprietaire,
    dossierSecrets: dossier,
    ecoute: '127.0.0.1',
    port: 0,
    journal,
    delaiReconnexionMs: 20,
    postes: r.postes,
    sessions: pontEnregistreur(r.postes, r.poste, r.appels),
  });
}

function creerFederationBanc(proprietaire: string, r: Ressources, dossier: string): Federation {
  return new Federation({
    registre: r.registre,
    diffusion: r.diffusion,
    dossierSecrets: dossier,
    machine: proprietaire,
    pont: pontFederationSimule,
    journal,
    intervallePlanificationMs: 100,
    delaiDemandeMs: 2000,
    observer: (_sens, charge) => r.charges.push(charge),
  });
}

export function creerNoeud(proprietaire: string): Noeud {
  const base = ouvrirBase(':memory:');
  const registre = new Registre(base, journal);
  const diffusion = new Diffusion();
  const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
  const poste = {
    data: { machine: 'tour' },
    send: () => undefined,
    close: () => undefined,
  } as unknown as ServerWebSocket<DonneesPoste>;
  const dossier = mkdtempSync(join(tmpdir(), `duo-aig-${proprietaire}-`));
  const dossierFederation = mkdtempSync(join(tmpdir(), `duo-aig-fed-${proprietaire}-`));
  const charges: string[] = [];
  const appels: Appels = { ouvrir: [], envoyer: [] };
  const r: Ressources = { registre, diffusion, postes, poste, appels, charges, dossiers: [dossier, dossierFederation] };
  const duo = creerDuoBanc(proprietaire, base, r, dossier);
  const federation = creerFederationBanc(proprietaire, r, dossierFederation);
  duo.demarrer();
  federation.demarrer();
  federation.brancherDuo(duo.brancherAiguilleur(federation.portDuo()));
  postes.ouvert(poste);
  const n: Noeud = { ...r, proprietaire, duo, federation, membre: '' };
  noeuds.push(n);
  return n;
}

/** Relie un nœud à l'aiguilleur avec un code neuf de son propriétaire, puis attend qu'il voie l'aiguilleur. */
export async function relier(n: Noeud): Promise<void> {
  const r = await n.federation.rejoindreAiguilleur({
    url: aiguilleur().url,
    code: codeAppairage(aiguilleur(), n.proprietaire),
    nom: n.proprietaire,
  });
  if (!r.ok) throw new Error(`rejoindre : ${r.raison}`);
  n.membre = r.valeur.id;
  await attendre(async () => (await n.federation.etat()).aiguilleur?.relie === true);
}

/** Déclare un lien duo entre deux propriétaires (commande locale de l'aiguilleur). */
export function lierDuo(a: string, b: string): void {
  executerCommande(['lier-duo', a, b], aiguilleur().annuaire);
}

/** Alice ouvre un code sur sa machine, Bob le saisit ; chacun confirme les empreintes ; le lien s'ouvre. */
export async function appairer(alice: Noeud, bob: Noeud): Promise<void> {
  const code = ok(alice.duo.codeAppairage());
  ok(await bob.duo.rejoindre(code.membre ?? '', code.code));
  await attendre(() => alice.duo.etat().appairage !== null);
  ok(alice.duo.confirmerAppairage(true));
  ok(bob.duo.confirmerAppairage(true));
  await attendre(() => alice.duo.etat().etat === 'connecte' && bob.duo.etat().etat === 'connecte');
}

export function ok<T>(r: Resultat<T>): T {
  if (!r.ok) throw new Error(`refus inattendu : ${r.raison}`);
  return r.valeur;
}

export function fiche(id: string, chemin: string, extra: Partial<ResumeSession> = {}): ResumeSession {
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
    ...extra,
  };
}

export function envoyerPoste(n: Noeud, message: object): void {
  n.postes.recu(n.poste, JSON.stringify(message));
}

export function textes(n: Noeud, id: string): string[] {
  return n.registre.derniersEvenements(id, 50).flatMap((e) => (e.evt.type === 'message' ? [e.evt.texte] : []));
}

export function partager(n: Noeud, corps: CorpsPartage): EtatDuo {
  return ok(n.duo.partager(corps));
}
