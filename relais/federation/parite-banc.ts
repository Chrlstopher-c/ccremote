// Banc commun des essais de parité : un aiguilleur réel, des nœuds réels reliés à lui, une session de A vue de B.
// Les essais de parité (texte, gestes, terminal, gros contenus, demandes) s'appuient sur ces mêmes helpers.
import { expect } from 'bun:test';
import type { MessageClient } from '../../commun/api-clients.ts';
import {
  attendre,
  creerNoeud,
  type Gestes,
  ficheDe,
  monterAiguilleur,
  type Monte,
  type Noeud,
  relier,
} from './banc-federation.ts';

export const SESSION_A = 'session-a';

let monte: Monte | null = null;
const crees: Noeud[] = [];

/** Un aiguilleur neuf pour l'essai en cours. */
export function demarrerBanc(): void {
  monte = monterAiguilleur();
}

/** Arrête les nœuds et l'aiguilleur de l'essai en cours. */
export function arreterBanc(): void {
  for (const n of crees.splice(0)) n.federation.arreter();
  monte?.serveur.stop(true);
  monte = null;
}

/** Un nœud neuf, relié à l'aiguilleur du propriétaire « alice ». `gestes` : sa réponse aux gestes relayés. */
export async function nouveau(nom: string, gestes?: Gestes): Promise<Noeud> {
  if (!monte) throw new Error('banc non démarré');
  const n = creerNoeud(nom, {}, gestes);
  crees.push(n);
  await relier(n, monte, 'alice');
  return n;
}

export async function idDe(n: Noeud): Promise<string> {
  const id = (await n.federation.etat()).aiguilleur?.id;
  if (!id) throw new Error('nœud non relié');
  return id;
}

async function enLignePour(vu: Noeud, cible: string): Promise<void> {
  await attendre(async () => (await vu.federation.etat()).membres.some((m) => m.id === cible && m.enLigne));
}

/** Appairage complet : A demande, B accepte, le lien chiffré s'ouvre des deux côtés. */
export async function appairer(a: Noeud, b: Noeud): Promise<{ idA: string; idB: string }> {
  const idA = await idDe(a);
  const idB = await idDe(b);
  await enLignePour(a, idB);
  expect(a.federation.appairer(idB).ok).toBe(true);
  await attendre(async () => (await b.federation.etat()).demandes.length === 1);
  const demande = (await b.federation.etat()).demandes[0];
  expect(b.federation.decider(demande?.id ?? '', true).ok).toBe(true);
  await attendre(async () => (await a.federation.etat()).noeuds.some((n) => n.id === idB && n.liaisonOuverte));
  await attendre(async () => (await b.federation.etat()).noeuds.some((n) => n.id === idA && n.liaisonOuverte));
  return { idA, idB };
}

/** Une session de A, annoncée, vue de B : prête pour les gestes relayés. */
export async function sessionVue(a: Noeud, b: Noeud): Promise<void> {
  await appairer(a, b);
  a.registre.enregistrerSession(ficheDe(SESSION_A, 'tour', 'Titre A'));
  a.diffusion.diffuser({ type: 'session', session: ficheDe(SESSION_A, 'tour', 'Titre A') });
  await attendre(() => b.federation.distantes.sessions().some((s) => s.session.id === SESSION_A));
}

/** Ce qu'un nœud diffuse à ses clients locaux, à partir de maintenant. */
export function ecouter(n: Noeud): MessageClient[] {
  const recus: MessageClient[] = [];
  n.diffusion.ecouter((m) => recus.push(m));
  return recus;
}

export function requete(chemin: string, methode = 'GET', corps?: string): Request {
  return new Request(`http://noeud.local${chemin}`, { method: methode, ...(corps ? { body: corps } : {}) });
}
