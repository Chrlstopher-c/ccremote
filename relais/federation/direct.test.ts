// Liaisons directes entre nœuds, sans aiguilleur (ou en repli) : deux nœuds sur 127.0.0.1 s'appairent avec décision et
// fédèrent leurs sessions ; un faux bonjour est refusé ; une liaison coupée se rétablit, et le pair reste joignable par
// l'aiguilleur entre-temps. Données de test seulement.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { exporterIdentitePublique, genererIdentite } from '../../commun/chiffrement/identite.ts';
import {
  attendre,
  creerNoeud,
  ficheDe,
  monterAiguilleur,
  type Monte,
  type Noeud,
  relier,
} from './banc-federation.ts';

const SESSION_A = 'session-a';

let monte: Monte | null = null;
let noeuds: Noeud[] = [];

beforeEach(() => {
  noeuds = [];
});

afterEach(() => {
  for (const n of noeuds) n.federation.arreter();
  monte?.serveur.stop(true);
  monte = null;
});

/** Un nœud sans aiguilleur, avec son écoute directe sur un port libre et son propriétaire. */
async function noeudDirect(nom: string, proprietaire = 'essai'): Promise<Noeud> {
  const n = creerNoeud(nom, {});
  noeuds.push(n);
  await attendre(() => n.federation.identifiantLocal() !== null);
  n.federation.configurerDirecte({ ecoute: '127.0.0.1:0', proprietaire });
  await attendre(async () => (await n.federation.etat()).directe?.ecouteReelle != null);
  return n;
}

async function portDe(n: Noeud): Promise<number> {
  const port = (await n.federation.etat()).directe?.ecouteReelle;
  if (port == null) throw new Error('pas d’écoute directe');
  return port;
}

function idDe(n: Noeud): string {
  const id = n.federation.identifiantLocal();
  if (!id) throw new Error('identifiant local absent');
  return id;
}

async function liaisonDirecte(vu: Noeud, cible: string, ouverte: boolean): Promise<void> {
  await attendre(async () => (await vu.federation.etat()).liaisons?.some((l) => l.id === cible && l.enLigne === ouverte) === true, 6000);
}

async function appairerDirect(a: Noeud, b: Noeud): Promise<string> {
  const portB = await portDe(b);
  const r = await a.federation.appairerDirect(`127.0.0.1:${portB}`);
  if (!r.ok) throw new Error(`appairage direct : ${r.raison}`);
  await attendre(async () => (await b.federation.etat()).demandes.length === 1);
  const demande = (await b.federation.etat()).demandes[0];
  expect(b.federation.decider(demande?.id ?? '', true).ok).toBe(true);
  await attendre(async () => (await a.federation.etat()).noeuds.some((n) => n.id === r.valeur.membre && n.liaisonOuverte));
  await attendre(async () => (await b.federation.etat()).noeuds.some((n) => n.id === idDe(a) && n.liaisonOuverte));
  return r.valeur.membre;
}

describe('sans aiguilleur : appairage et fédération en direct', () => {
  test('deux nœuds sur 127.0.0.1 s’appairent avec décision, fédèrent leurs sessions, sans aiguilleur', async () => {
    const a = await noeudDirect('tour');
    const b = await noeudDirect('portable');
    expect((await a.federation.etat()).aiguilleur).toBeNull();
    const idB = await appairerDirect(a, b);
    expect(idB).toBe(idDe(b));
    expect((await a.federation.etat()).aiguilleur).toBeNull();

    a.registre.enregistrerSession(ficheDe(SESSION_A, 'tour', 'Titre A'));
    a.diffusion.diffuser({ type: 'session', session: ficheDe(SESSION_A, 'tour', 'Titre A') });
    await attendre(() => b.federation.distantes.sessions().some((s) => s.session.id === SESSION_A));
    expect(b.federation.distantes.sessions().find((s) => s.session.id === SESSION_A)?.membre).toBe(idDe(a));
  });

  test('une adresse qui ne répond pas : aucun appairage, aucune liaison', async () => {
    const a = await noeudDirect('tour');
    const r = await a.federation.appairerDirect('127.0.0.1:1');
    expect(r.ok).toBe(false);
    expect((await a.federation.etat()).liaisons ?? []).toEqual([]);
  });

  test('un bonjour qui se dit un pair sans en prouver la clé est refusé : aucune présence', async () => {
    const b = await noeudDirect('portable');
    const portB = await portDe(b);
    const faux = await genererIdentite();
    const recus: string[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${portB}/direct`);
    ws.onmessage = (ev) => recus.push(String(ev.data));
    await new Promise<void>((resoudre) => {
      ws.onopen = () => resoudre();
    });
    await attendre(() => recus.length > 0);
    const imposteur = 'a1b2c3d4e5f6';
    ws.send(
      JSON.stringify({
        t: 'bonjour',
        de: imposteur,
        identite: exporterIdentitePublique(faux.publique),
        nom: 'imposteur',
        defi: 'A'.repeat(43),
        signature: 'B'.repeat(86),
      }),
    );
    await attendre(() => ws.readyState === WebSocket.CLOSED, 4000);
    expect((await b.federation.etat()).membres.some((m) => m.id === imposteur && m.enLigne)).toBe(false);
  });

  test('un troisième nœud qui demande un appairage n’ouvre rien sans la décision de Chris', async () => {
    const a = await noeudDirect('tour');
    const b = await noeudDirect('portable');
    await appairerDirect(a, b);
    const portB = await portDe(b);
    const c = await noeudDirect('bureau');
    expect((await c.federation.appairerDirect(`127.0.0.1:${portB}`)).ok).toBe(true);
    await attendre(async () => (await b.federation.etat()).demandes.length === 1);
    await Bun.sleep(300);
    expect((await c.federation.etat()).noeuds.some((n) => n.liaisonOuverte)).toBe(false);
    expect((await b.federation.etat()).noeuds.filter((n) => n.id === idDe(c)).some((n) => n.liaisonOuverte)).toBe(false);
  });

  test('deux liaisons lancées en même temps : une seule reste, et elle tient des deux côtés', async () => {
    const a = await noeudDirect('tour');
    const b = await noeudDirect('portable');
    const idB = await appairerDirect(a, b);
    const portA = await portDe(a);
    const portB = await portDe(b);
    expect(a.federation.transportPair(idB, `127.0.0.1:${portB}`).ok).toBe(true);
    expect(b.federation.transportPair(idDe(a), `127.0.0.1:${portA}`).ok).toBe(true);
    await liaisonDirecte(a, idB, true);
    await liaisonDirecte(b, idDe(a), true);
    await Bun.sleep(600);
    await liaisonDirecte(a, idB, true);
    await liaisonDirecte(b, idDe(a), true);
  });
});

describe('repli : liaison directe coupée, retour, et aiguilleur entre-temps', () => {
  test('le pair reste joignable par l’aiguilleur pendant la coupure ; le lien direct revient seul', async () => {
    monte = monterAiguilleur();
    const aiguilleur = monte;
    const a = creerNoeud('tour', {});
    const b = creerNoeud('portable', {});
    noeuds.push(a, b);
    await relier(a, aiguilleur, 'alice');
    await relier(b, aiguilleur, 'alice');
    const idB = (await b.federation.etat()).aiguilleur?.id ?? '';
    await attendre(async () => (await a.federation.etat()).membres.some((m) => m.id === idB && m.enLigne));
    a.federation.appairer(idB);
    await attendre(async () => (await b.federation.etat()).demandes.length === 1);
    expect(b.federation.decider((await b.federation.etat()).demandes[0]?.id ?? '', true).ok).toBe(true);
    await attendre(async () => (await a.federation.etat()).noeuds.some((n) => n.id === idB && n.liaisonOuverte));

    b.federation.configurerDirecte({ ecoute: '127.0.0.1:0' });
    const portB = await portDe(b);
    expect(a.federation.transportPair(idB, `127.0.0.1:${portB}`).ok).toBe(true);
    await liaisonDirecte(a, idB, true);

    b.federation.configurerDirecte({ ecoute: null });
    await liaisonDirecte(a, idB, false);
    await attendre(() => a.federation.machineEnLigne(idB));

    b.federation.configurerDirecte({ ecoute: `127.0.0.1:${portB}` });
    await liaisonDirecte(a, idB, true);
  });
});
