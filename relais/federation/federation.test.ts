// Fédération « mes machines » sur un aiguilleur réel (127.0.0.1) : appairage avec décision, sessions listées, fil en
// direct, écriture relayée, hors ligne, révocation, et ce que l'aiguilleur peut voir. Données de test seulement.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CHEMIN_APPAIRAGE_MEMBRE } from '../../commun/aiguilleur.ts';
import { exporterIdentitePublique, genererIdentite } from '../../commun/chiffrement/identite.ts';
import type { EvenementFedere } from '../../commun/federation.ts';
import { executerCommande } from '../aiguilleur/commande.ts';
import {
  attendre,
  creerNoeud,
  ficheDe,
  MAJ,
  monterAiguilleur,
  type Monte,
  type Noeud,
  relier,
} from './banc-federation.ts';

const SESSION_A = 'session-a';
const TEXTE_SECRET = 'contenu confidentiel de A';

let monte: Monte;
let noeuds: Noeud[] = [];

beforeEach(() => {
  monte = monterAiguilleur();
  noeuds = [];
});

afterEach(() => {
  for (const n of noeuds) n.federation.arreter();
  monte.serveur.stop(true);
});

async function nouveau(nom: string, proprietaire = 'alice', options = {}): Promise<Noeud> {
  const n = creerNoeud(nom, options);
  noeuds.push(n);
  await relier(n, monte, proprietaire);
  return n;
}

/** Une session créée localement : enregistrée, puis annoncée comme le fait le relais (diffusion). */
function poser(n: Noeud, fiche: ReturnType<typeof ficheDe>): void {
  n.registre.enregistrerSession(fiche);
  n.diffusion.diffuser({ type: 'session', session: fiche });
}

function evenement(n: Noeud, session: string, texte: string): void {
  const evt = { type: 'message' as const, texte };
  const evenement = n.registre.ajouterEvenement(session, MAJ, evt);
  n.diffusion.diffuser({ type: 'evenement', evenement });
}

async function idDe(n: Noeud): Promise<string> {
  const id = (await n.federation.etat()).aiguilleur?.id;
  if (!id) throw new Error('nœud non relié');
  return id;
}

async function enLignePour(vu: Noeud, cible: string): Promise<void> {
  await attendre(async () => (await vu.federation.etat()).membres.some((m) => m.id === cible && m.enLigne));
}

/** Appairage complet : A demande, B accepte, le lien chiffré s'ouvre des deux côtés. */
async function appairer(a: Noeud, b: Noeud): Promise<{ idA: string; idB: string }> {
  const idA = await idDe(a);
  const idB = await idDe(b);
  await enLignePour(a, idB);
  const r = a.federation.appairer(idB);
  expect(r.ok).toBe(true);
  await attendre(async () => (await b.federation.etat()).demandes.length === 1);
  const demande = (await b.federation.etat()).demandes[0];
  expect(b.federation.decider(demande?.id ?? '', true).ok).toBe(true);
  await attendre(async () => (await a.federation.etat()).noeuds.some((n) => n.id === idB && n.liaisonOuverte));
  await attendre(async () => (await b.federation.etat()).noeuds.some((n) => n.id === idA && n.liaisonOuverte));
  return { idA, idB };
}

describe('appairage entre nœuds', () => {
  test('la demande porte les deux empreintes ; une fois acceptée, le lien s’ouvre', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    const idB = await idDe(b);
    await enLignePour(a, idB);
    expect(a.federation.appairer(idB).ok).toBe(true);
    await attendre(async () => (await b.federation.etat()).demandes.length === 1);
    const etatB = await b.federation.etat();
    const demande = etatB.demandes[0];
    const etatA = await a.federation.etat();
    expect(demande?.empreinte).toBe(etatA.empreinteLocale);
    expect(demande?.empreinteLocale).toBe(etatB.empreinteLocale);
    expect(demande?.empreinte).not.toBe(demande?.empreinteLocale);
    expect(b.federation.decider(demande?.id ?? '', true).ok).toBe(true);
    await attendre(async () => (await a.federation.etat()).noeuds.some((n) => n.liaisonOuverte));
    expect((await a.federation.etat()).noeuds[0]?.empreinte).toBe(etatB.empreinteLocale);
  });

  test('refus : aucun appairage des deux côtés, aucune session ne passe', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    const idB = await idDe(b);
    const idA = await idDe(a);
    await enLignePour(a, idB);
    poser(a, ficheDe(SESSION_A, 'tour', 'Titre A'));
    a.federation.appairer(idB);
    await attendre(async () => (await b.federation.etat()).demandes.length === 1);
    b.federation.decider((await b.federation.etat()).demandes[0]?.id ?? '', false);
    await attendre(async () => (await a.federation.etat()).appairages.length === 0);
    expect((await a.federation.etat()).noeuds).toEqual([]);
    expect((await b.federation.etat()).noeuds).toEqual([]);
    expect(b.federation.distantes.sessions()).toEqual([]);
    expect(idA).not.toBe(idB);
  });

  test('délai sans réponse : la demande est refusée d’elle-même', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable', 'alice', { delaiDemandeMs: 150 });
    const idB = await idDe(b);
    await enLignePour(a, idB);
    a.federation.appairer(idB);
    await attendre(async () => (await b.federation.etat()).demandes.length === 1);
    await attendre(async () => (await b.federation.etat()).demandes.length === 0, 3000);
    expect((await b.federation.etat()).noeuds).toEqual([]);
  });
});

describe('sessions du pair', () => {
  test('les sessions de A sont listées chez B, le fil se lit à la demande et suit en direct', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    const { idA, idB } = await appairer(a, b);
    poser(a, ficheDe(SESSION_A, 'tour', 'Titre A'));
    evenement(a, SESSION_A, TEXTE_SECRET);
    await attendre(() => b.federation.distantes.sessions().some((s) => s.session.id === SESSION_A));
    const vue = b.federation.distantes.sessions().find((s) => s.session.id === SESSION_A);
    expect(vue?.machine).toBe('tour');
    expect(vue?.enLigne).toBe(true);
    expect(vue?.membre).toBe(idA);
    expect(idB).not.toBe(idA);
    const fil = await b.federation.distantes.fil(idA, SESSION_A);
    expect(fil.ok).toBe(true);
    expect(fil.ok && fil.valeur.map((e) => e.evt)).toEqual([{ type: 'message', texte: TEXTE_SECRET }]);
    evenement(a, SESSION_A, 'suite en direct');
    await attendre(() => b.federation.distantes.filEnMemoire(idA, SESSION_A).length === 2);
  });

  test('écriture, interruption et ouverture sont relayées au nœud qui tient la session', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    const { idA } = await appairer(a, b);
    poser(a, ficheDe(SESSION_A, 'tour', 'Titre A'));
    await attendre(() => b.federation.distantes.sessions().length === 1);
    expect((await b.federation.distantes.ecrire(idA, SESSION_A, 'bonjour de B')).ok).toBe(true);
    expect((await b.federation.distantes.interrompre(idA, SESSION_A)).ok).toBe(true);
    expect(a.appels.ecrire).toEqual([[SESSION_A, 'bonjour de B']]);
    expect(a.appels.interrompre).toEqual([SESSION_A]);
    const ouverture = await b.federation.distantes.ouvrir(idA, 'tour', '/projets/neuf', 'prépare un plan');
    expect(ouverture).toEqual({ ok: true, valeur: { session: 'ouverte-tour' } });
    expect(a.appels.ouvrir).toEqual([{ chemin: '/projets/neuf', message: 'prépare un plan' }]);
    const refus = await b.federation.distantes.ouvrir(idA, 'pi', '/projets/x', 'x');
    expect(refus.ok).toBe(false);
    expect((await b.federation.distantes.ecrire(idA, 'inconnue', 'x')).ok).toBe(false);
  });
});

describe('présence, révocation et ce que voient les autres', () => {
  test('nœud éteint : ses sessions restent visibles hors ligne ; relancé, il revient', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    const { idA } = await appairer(a, b);
    poser(a, ficheDe(SESSION_A, 'tour', 'Titre A'));
    await attendre(() => b.federation.distantes.sessions().length === 1);
    a.federation.arreter();
    await attendre(() => b.federation.distantes.sessions()[0]?.enLigne === false);
    expect(b.federation.distantes.sessions()).toHaveLength(1);
    expect((await b.federation.distantes.ecrire(idA, SESSION_A, 'x')).ok).toBe(false);
    a.federation.demarrer();
    await attendre(() => b.federation.distantes.sessions()[0]?.enLigne === true, 6000);
    expect((await b.federation.distantes.ecrire(idA, SESSION_A, 'revenu')).ok).toBe(true);
  });

  test('révocation : plus rien chez l’autre, pairs effacés des deux côtés, sessions disparues', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    const { idA, idB } = await appairer(a, b);
    poser(a, ficheDe(SESSION_A, 'tour', 'Titre A'));
    await attendre(() => b.federation.distantes.sessions().length === 1);
    expect(b.federation.revoquer(idA).ok).toBe(true);
    await attendre(async () => (await a.federation.etat()).noeuds.length === 0);
    expect(b.federation.distantes.sessions()).toEqual([]);
    expect((await b.federation.etat()).noeuds).toEqual([]);
    expect(b.federation.revoquer(idA).ok).toBe(false);
    expect(a.federation.appairer(idB).ok).toBe(true);
  });

  test('aiguilleur : seules des charges chiffrées sur un lien ; rien de A dans la base de B', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    const { idA } = await appairer(a, b);
    poser(a, ficheDe(SESSION_A, 'tour', 'Titre A'));
    evenement(a, SESSION_A, TEXTE_SECRET);
    await attendre(() => b.federation.distantes.sessions().length === 1);
    await b.federation.distantes.fil(idA, SESSION_A);
    const charges = [...a.charges, ...b.charges];
    const clairs = charges.filter((c) => !c.includes('"t":"chiffre"'));
    expect(charges.length).toBeGreaterThan(0);
    for (const charge of charges) {
      expect(charge).not.toContain(TEXTE_SECRET);
      expect(charge).not.toContain('Titre A');
    }
    for (const charge of clairs)
      expect(/"t":"(presentation|accord|poignee|poignee-reponse|refus)"/.test(charge)).toBe(true);
    expect(b.registre.session(SESSION_A)).toBeNull();
    expect(b.registre.sessions(true)).toEqual([]);
    expect(b.registre.derniersEvenements(SESSION_A, 10)).toEqual([]);
  });
});

/** Un membre factice du propriétaire donné, appairé comme un vrai nœud : il parle au lien, sans nœud derrière. */
async function fauxMembre(proprietaire: string): Promise<string> {
  const code = executerCommande(['appairer', proprietaire], monte.annuaire).split('\n')[0] ?? '';
  const cle = exporterIdentitePublique((await genererIdentite()).publique);
  const rep = await fetch(new URL(CHEMIN_APPAIRAGE_MEMBRE, monte.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, nom: 'intrus', genre: 'noeud', cle }),
  });
  return ((await rep.json()) as { jeton: string }).jeton;
}

async function lienFaux(jeton: string): Promise<{ ws: WebSocket; recus: Record<string, unknown>[] }> {
  const recus: Record<string, unknown>[] = [];
  return new Promise((resoudre, rejeter) => {
    const ws = new WebSocket(`${monte.url.replace('http', 'ws')}/aiguilleur`, {
      headers: { authorization: `Bearer ${jeton}` },
    });
    ws.onmessage = (e) => void recus.push(JSON.parse(String(e.data)) as Record<string, unknown>);
    ws.onopen = () => resoudre({ ws, recus });
    ws.onerror = () => rejeter(new Error('lien refusé'));
  });
}

describe('mes machines : propriétaire', () => {
  test('même propriétaire : le nœud connaît le sien, voit nom et genre de ses pairs, et peut appairer', async () => {
    const a = await nouveau('tour', 'alice');
    const b = await nouveau('portable', 'alice');
    const idB = await idDe(b);
    await enLignePour(a, idB);
    const etat = await a.federation.etat();
    expect(etat.aiguilleur?.proprietaire).toBe('alice');
    expect(etat.membres).toEqual([
      { id: idB, enLigne: true, nom: 'portable', genre: 'noeud', proprietaire: 'alice', mien: true },
    ]);
    expect(a.federation.appairer(idB).ok).toBe(true);
  });

  test('un nœud d’un autre propriétaire, même relié par un duo, ne s’appaire pas', async () => {
    executerCommande(['lier-duo', 'alice', 'bob'], monte.annuaire);
    const a = await nouveau('tour', 'alice');
    const b = await nouveau('portable', 'bob');
    const idB = await idDe(b);
    // L'aiguilleur ne montre pas un nœud d'un autre propriétaire (fd01f7b) : inconnu, donc pas des nôtres.
    await attendre(async () => (await a.federation.etat()).aiguilleur?.relie === true);
    expect(a.federation.appairer(idB)).toEqual({ ok: false, statut: 409, raison: 'propriétaire inconnu' });
    expect((await a.federation.etat()).membres.some((m) => m.id === idB)).toBe(false);
    expect((await b.federation.etat()).demandes).toEqual([]);
  });

  test('côté visé : la présentation d’un membre qui n’est pas des nôtres est refusée sans demande', async () => {
    executerCommande(['lier-duo', 'alice', 'bob'], monte.annuaire);
    const b = await nouveau('portable', 'alice');
    const idB = await idDe(b);
    const { ws, recus } = await lienFaux(await fauxMembre('bob'));
    ws.send(JSON.stringify({ t: 'ouvrir', canal: 'intrus1', vers: idB }));
    await attendre(() => recus.some((m) => m['t'] === 'accepter'));
    const identite = exporterIdentitePublique((await genererIdentite()).publique);
    const presentation = { t: 'presentation', identite, nom: 'intrus' };
    ws.send(JSON.stringify({ t: 'donnees', canal: 'intrus1', charge: JSON.stringify(presentation) }));
    await attendre(() => recus.some((m) => m['t'] === 'donnees' && String(m['charge']).includes('"t":"refus"')));
    expect((await b.federation.etat()).demandes).toEqual([]);
    ws.close();
  });
});

describe('gardes', () => {
  test('appairage refusé hors lien ou pour un nœud hors ligne ; requête vers un non-relié', async () => {
    const seul = creerNoeud('seul');
    noeuds.push(seul);
    expect(seul.federation.appairer('000000000000').ok).toBe(false);
    expect((await seul.federation.distantes.fil('000000000000', SESSION_A)).ok).toBe(false);
    const a = await nouveau('tour');
    expect(a.federation.appairer('ffffffffffff').ok).toBe(false);
    const evenement: EvenementFedere = { ts: MAJ, evt: { type: 'message', texte: 'x' } };
    expect(evenement.ts).toBe(MAJ);
  });

  test('un second rattachement à un aiguilleur est refusé', async () => {
    const a = await nouveau('tour');
    const r = await a.federation.rejoindreAiguilleur({ url: monte.url, code: 'AAAA-BBBB', nom: 'tour' });
    expect(r.ok).toBe(false);
  });
});
