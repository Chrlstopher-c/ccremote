// Aiguilleur réel sur 127.0.0.1 (base en mémoire, données de test) : appairage par code, canaux entre membres, refus,
// duo, révocation, charge bornée, présence, journaux sans charge ni jeton.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import pino from 'pino';
import { PlafondEchecs } from '../acces/plafond.ts';
import { LIMITE_CHARGE_OCTETS } from '../../commun/aiguilleur.ts';
import { ouvrirAnnuaire } from './annuaire-base.ts';
import { Annuaire } from './annuaire.ts';
import { type Aiguilleur, creerAiguilleur } from './aiguilleur.ts';
import { executerCommande } from './commande.ts';

type Message = Record<string, unknown>;
type Genre = 'noeud' | 'appareil';

interface Contexte {
  readonly db: Database;
  readonly annuaire: Annuaire;
  readonly aiguilleur: Aiguilleur;
  readonly serveur: ReturnType<typeof Bun.serve>;
  readonly port: number;
  readonly lignes: string[];
  readonly liens: Lien[];
}

let contexte: Contexte | null = null;

function monter(maxCanaux?: number): Contexte {
  const lignes: string[] = [];
  const journal = pino({ level: 'trace' }, { write: (s: string) => void lignes.push(s) });
  const db = ouvrirAnnuaire(':memory:');
  const annuaire = new Annuaire(db);
  const plafond = new PlafondEchecs(join(mkdtempSync(join(tmpdir(), 'aiguilleur-essai-')), 'echecs.json'), journal);
  const aiguilleur = creerAiguilleur({ annuaire, journal, plafond, maxCanaux });
  const serveur = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: aiguilleur.fetch,
    websocket: aiguilleur.websocket,
  });
  return { db, annuaire, aiguilleur, serveur, port: serveur.port ?? 0, lignes, liens: [] };
}

function ici(): Contexte {
  if (!contexte) throw new Error('aiguilleur non démarré');
  return contexte;
}

function genererCle(): string {
  return randomBytes(32).toString('base64url');
}

/** Toutes les lignes de toutes les tables, pour vérifier qu'un secret n'y figure jamais en clair. */
function contenuDesTables(db: Database): unknown[] {
  const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return tables.map((t) => db.query(`SELECT * FROM ${t.name}`).all());
}

function sha256(texte: string): string {
  return createHash('sha256').update(texte).digest('hex');
}

/** Un membre appairé par code (commande locale puis échange HTTP) : identifiant et jeton. */
async function membre(proprietaire: string, genre: Genre = 'noeud'): Promise<{ id: string; jeton: string }> {
  const c = ici();
  const code = executerCommande(['appairer', proprietaire], c.annuaire).split('\n')[0] ?? '';
  const rep = await fetch(`http://127.0.0.1:${c.port}/api/membres/appairer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, nom: `${proprietaire}-${genre}`, genre, cle: genererCle() }),
  });
  expect(rep.status).toBe(200);
  return (await rep.json()) as { id: string; jeton: string };
}

/** Un lien sortant authentifié : reçoit les messages dans l'ordre, consultables par attente. */
class Lien {
  readonly recus: Message[] = [];
  readonly fermetures: number[] = [];
  private readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (e) => void this.recus.push(JSON.parse(String(e.data)) as Message);
    ws.onclose = (e) => void this.fermetures.push(e.code);
  }

  static ouvrir(port: number, jeton: string): Promise<Lien> {
    return new Promise((resoudre, rejeter) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/aiguilleur`, { headers: { authorization: `Bearer ${jeton}` } });
      ws.onopen = () => resoudre(new Lien(ws));
      ws.onerror = () => rejeter(new Error('lien refusé'));
    });
  }

  envoyer(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  async attendre(predicat: (m: Message) => boolean, ms = 2000): Promise<Message> {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      const trouve = this.recus.find(predicat);
      if (trouve) return trouve;
      await Bun.sleep(10);
    }
    throw new Error(`message attendu absent : ${JSON.stringify(this.recus)}`);
  }

  async silence(ms = 150): Promise<void> {
    await Bun.sleep(ms);
  }

  de(type: string): Message[] {
    return this.recus.filter((m) => m['t'] === type);
  }

  fermer(): void {
    this.ws.close();
  }
}

async function lien(m: { id: string; jeton: string }): Promise<Lien> {
  const l = await Lien.ouvrir(ici().port, m.jeton);
  ici().liens.push(l);
  return l;
}

beforeEach(() => {
  contexte = monter();
});

afterEach(() => {
  const c = contexte;
  if (!c) return;
  for (const l of c.liens) l.fermer();
  c.serveur.stop(true);
  contexte = null;
});

describe('schéma : l’annuaire seulement', () => {
  test('aucune table de sessions, d’événements ni de réglages', () => {
    const db = ouvrirAnnuaire(':memory:');
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(['appairages', 'jetons', 'liens_duo', 'membres']);
    const colonnes = (db.query('PRAGMA table_info(membres)').all() as { name: string }[]).map((c) => c.name);
    expect(colonnes.sort()).toEqual(['cree_le', 'empreinte_cle', 'genre', 'id', 'nom', 'proprietaire', 'revoque_le']);
    db.close();
  });
});

describe('appairage', () => {
  test('un code à usage unique donne un membre et un jeton ; seule l’empreinte de la clé est gardée', async () => {
    const c = ici();
    const cle = genererCle();
    const code = executerCommande(['appairer', 'chris'], c.annuaire).split('\n')[0] ?? '';
    const rep = await fetch(`http://127.0.0.1:${c.port}/api/membres/appairer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, nom: 'portable', genre: 'noeud', cle }),
    });
    expect(rep.status).toBe(200);
    const { id, jeton } = (await rep.json()) as { id: string; jeton: string };
    expect(c.annuaire.membre(id)?.empreinteCle).toBe(sha256(cle));
    const rejoue = await fetch(`http://127.0.0.1:${c.port}/api/membres/appairer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, nom: 'rejeu', genre: 'noeud', cle: genererCle() }),
    });
    expect(rejoue.status).toBe(401);
    const contenu = JSON.stringify(contenuDesTables(c.db));
    expect(contenu).not.toContain(cle);
    expect(contenu).not.toContain(jeton);
    expect(contenu).toContain(sha256(jeton));
  });

  test('la réponse d’appairage porte le propriétaire du code consommé', async () => {
    const c = ici();
    const code = executerCommande(['appairer', 'matheo'], c.annuaire).split('\n')[0] ?? '';
    const rep = await fetch(`http://127.0.0.1:${c.port}/api/membres/appairer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, nom: 'portable', genre: 'appareil', cle: genererCle() }),
    });
    expect(await rep.json()).toEqual({
      id: expect.any(String),
      jeton: expect.any(String),
      proprietaire: 'matheo',
    });
  });

  test('code faux 401, clé mal formée 400, aucun membre créé', async () => {
    const c = ici();
    executerCommande(['appairer', 'chris'], c.annuaire);
    const corps = (cle: string) => JSON.stringify({ code: 'ZZZZ-ZZZZ', nom: 'x', genre: 'noeud', cle });
    const url = `http://127.0.0.1:${c.port}/api/membres/appairer`;
    const faux = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: corps(genererCle()),
    });
    expect(faux.status).toBe(401);
    const tropCourt = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: corps('court'),
    });
    expect(tropCourt.status).toBe(400);
    expect(c.annuaire.membres()).toHaveLength(0);
  });

  test('après 5 échecs depuis une adresse, même un bon code est refusé (429)', async () => {
    const c = ici();
    const bon = executerCommande(['appairer', 'chris'], c.annuaire).split('\n')[0] ?? '';
    const url = `http://127.0.0.1:${c.port}/api/membres/appairer`;
    for (let i = 0; i < 5; i++) {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'ZZZZ-ZZZZ', nom: 'x', genre: 'noeud', cle: genererCle() }),
      });
      expect(r.status).toBe(401);
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: bon, nom: 'x', genre: 'noeud', cle: genererCle() }),
    });
    expect(r.status).toBe(429);
  });
});

describe('accès au lien', () => {
  test('sans jeton ou avec un jeton inconnu, le lien est refusé', async () => {
    const c = ici();
    const sans = await fetch(`http://127.0.0.1:${c.port}/aiguilleur`, { headers: { upgrade: 'websocket' } });
    expect(sans.status).toBe(401);
    const inconnu = await fetch(`http://127.0.0.1:${c.port}/aiguilleur`, {
      headers: { upgrade: 'websocket', authorization: 'Bearer inconnu' },
    });
    expect(inconnu.status).toBe(401);
  });
});

describe('canaux entre membres', () => {
  test('deux membres du même propriétaire : canal accepté, charges échangées dans les deux sens', async () => {
    const a = await membre('chris');
    const b = await membre('chris');
    const la = await lien(a);
    const lb = await lien(b);
    la.envoyer({ t: 'ouvrir', canal: 'c1', vers: b.id });
    expect(await lb.attendre((m) => m['t'] === 'ouvrir')).toEqual({
      t: 'ouvrir',
      canal: 'c1',
      de: a.id,
      proprietaire: 'chris',
    });
    lb.envoyer({ t: 'accepter', canal: 'c1' });
    await la.attendre((m) => m['t'] === 'accepter');
    la.envoyer({ t: 'donnees', canal: 'c1', charge: 'bonjour-A' });
    expect((await lb.attendre((m) => m['t'] === 'donnees')).charge).toBe('bonjour-A');
    lb.envoyer({ t: 'donnees', canal: 'c1', charge: 'bonjour-B' });
    expect((await la.attendre((m) => m['t'] === 'donnees')).charge).toBe('bonjour-B');
  });

  test('refus : l’ouvrant est prévenu, aucune donnée ne passe', async () => {
    const a = await membre('chris');
    const b = await membre('chris');
    const la = await lien(a);
    const lb = await lien(b);
    la.envoyer({ t: 'ouvrir', canal: 'c2', vers: b.id });
    await lb.attendre((m) => m['t'] === 'ouvrir');
    lb.envoyer({ t: 'refuser', canal: 'c2' });
    await la.attendre((m) => m['t'] === 'refuser');
    la.envoyer({ t: 'donnees', canal: 'c2', charge: 'malgré-refus' });
    expect((await la.attendre((m) => m['t'] === 'erreur')).motif).toBe('canal-inconnu');
    await lb.silence();
    expect(lb.de('donnees')).toHaveLength(0);
  });

  test('données avant acceptation refusées ; seul le membre visé peut accepter', async () => {
    const a = await membre('chris');
    const b = await membre('chris');
    const la = await lien(a);
    const lb = await lien(b);
    la.envoyer({ t: 'ouvrir', canal: 'c3', vers: b.id });
    await lb.attendre((m) => m['t'] === 'ouvrir');
    la.envoyer({ t: 'donnees', canal: 'c3', charge: 'trop-tot' });
    expect((await la.attendre((m) => m['t'] === 'erreur')).motif).toBe('canal-non-ouvert');
    la.envoyer({ t: 'accepter', canal: 'c3' });
    expect((await la.attendre((m) => m['t'] === 'erreur' && m['motif'] === 'non-autorise')).motif).toBe('non-autorise');
    await lb.silence();
    expect(lb.de('donnees')).toHaveLength(0);
  });

  test('un membre ne peut pas s’ouvrir un canal vers lui-même', async () => {
    const a = await membre('chris');
    const la = await lien(a);
    la.envoyer({ t: 'ouvrir', canal: 'c4', vers: a.id });
    expect((await la.attendre((m) => m['t'] === 'erreur')).motif).toBe('non-autorise');
  });

  test('canal vers un membre hors ligne : erreur hors-ligne', async () => {
    const a = await membre('chris');
    const b = await membre('chris');
    const la = await lien(a);
    la.envoyer({ t: 'ouvrir', canal: 'c5', vers: b.id });
    expect((await la.attendre((m) => m['t'] === 'erreur')).motif).toBe('hors-ligne');
  });

  test('le nombre de canaux par membre est borné', async () => {
    contexte?.serveur.stop(true);
    const c = (contexte = monter(1));
    const a = await membre('chris');
    const b = await membre('chris');
    const la = await lien(a);
    const lb = await lien(b);
    la.envoyer({ t: 'ouvrir', canal: 'p1', vers: b.id });
    await lb.attendre((m) => m['t'] === 'ouvrir');
    la.envoyer({ t: 'ouvrir', canal: 'p2', vers: b.id });
    expect((await la.attendre((m) => m['t'] === 'erreur')).motif).toBe('trop-de-canaux');
    expect(c.lignes.join('')).toContain('canal');
  });
});

describe('autorisation : propriétaires et lien duo', () => {
  test('membre d’un autre propriétaire sans lien duo : refusé, rien ne lui parvient', async () => {
    const a = await membre('chris');
    const d = await membre('matheo');
    const la = await lien(a);
    const ld = await lien(d);
    ld.envoyer({ t: 'ouvrir', canal: 'c1', vers: a.id });
    expect((await ld.attendre((m) => m['t'] === 'erreur')).motif).toBe('non-autorise');
    await la.silence();
    expect(la.de('ouvrir')).toHaveLength(0);
  });

  test('avec un lien duo déclaré par commande locale : accepté dans les deux sens', async () => {
    const c = ici();
    executerCommande(['lier-duo', 'matheo', 'chris'], c.annuaire);
    const a = await membre('chris');
    const d = await membre('matheo');
    const la = await lien(a);
    const ld = await lien(d);
    ld.envoyer({ t: 'ouvrir', canal: 'duo', vers: a.id });
    expect(await la.attendre((m) => m['t'] === 'ouvrir')).toMatchObject({ de: d.id, proprietaire: 'matheo' });
    la.envoyer({ t: 'accepter', canal: 'duo' });
    await ld.attendre((m) => m['t'] === 'accepter');
    la.envoyer({ t: 'donnees', canal: 'duo', charge: 'par-le-duo' });
    expect((await ld.attendre((m) => m['t'] === 'donnees')).charge).toBe('par-le-duo');
  });
});

describe('révocation, présence, charge, journal', () => {
  test('membre révoqué : connexion coupée, pairs prévenus, nouveau lien refusé', async () => {
    const c = ici();
    const a = await membre('chris');
    const b = await membre('chris');
    const la = await lien(a);
    const lb = await lien(b);
    executerCommande(['revoquer', b.id], c.annuaire);
    c.aiguilleur.balayer();
    await Bun.sleep(50);
    expect(lb.fermetures).toEqual([4401]);
    const absent = await la.attendre(
      (m) => m['t'] === 'presence' && JSON.stringify(m).includes(`"${b.id}","enLigne":false`),
    );
    expect(absent['t']).toBe('presence');
    const rep = await fetch(`http://127.0.0.1:${c.port}/aiguilleur`, {
      headers: { upgrade: 'websocket', authorization: `Bearer ${b.jeton}` },
    });
    expect(rep.status).toBe(401);
  });

  test('présence : un membre voit ses pairs joignables et leur état, jamais un membre étranger', async () => {
    const a = await membre('chris');
    const b = await membre('chris');
    const etranger = await membre('matheo');
    const la = await lien(a);
    await lien(b);
    await lien(etranger);
    await la.attendre((m) => m['t'] === 'presence' && JSON.stringify(m['membres']).includes('"enLigne":true'));
    expect(la.de('presence').at(-1)?.['membres']).toEqual([
      { id: b.id, enLigne: true, nom: 'chris-noeud', genre: 'noeud', proprietaire: 'chris' },
    ]);
    expect(la.de('presence').at(-1)?.['proprietaire']).toBe('chris');
  });

  test('présence : chaque membre porte son nom, son genre et son propriétaire (appareil compris)', async () => {
    executerCommande(['lier-duo', 'matheo', 'chris'], ici().annuaire);
    const a = await membre('chris');
    const telephone = await membre('chris', 'appareil');
    const d = await membre('matheo');
    const la = await lien(a);
    await lien(telephone);
    await lien(d);
    await la.attendre(
      (m) => m['t'] === 'presence' && JSON.stringify(m['membres']).includes(`"${telephone.id}","enLigne":true`),
    );
    const vus = la.de('presence').at(-1)?.['membres'];
    // Le nœud du duo (autre propriétaire) n'est pas dans la présence tant qu'aucun canal duo n'est accepté.
    expect(vus).toHaveLength(1);
    expect(vus).toEqual([
      { id: telephone.id, enLigne: true, nom: 'chris-appareil', genre: 'appareil', proprietaire: 'chris' },
    ]);
  });

  test('une charge au-delà de 1 Mio est refusée, rien n’est livré', async () => {
    const a = await membre('chris');
    const b = await membre('chris');
    const la = await lien(a);
    const lb = await lien(b);
    la.envoyer({ t: 'ouvrir', canal: 'gros', vers: b.id });
    await lb.attendre((m) => m['t'] === 'ouvrir');
    lb.envoyer({ t: 'accepter', canal: 'gros' });
    await la.attendre((m) => m['t'] === 'accepter');
    la.envoyer({ t: 'donnees', canal: 'gros', charge: 'x'.repeat(LIMITE_CHARGE_OCTETS + 1) });
    expect((await la.attendre((m) => m['t'] === 'erreur')).motif).toBe('charge-trop-grande');
    await lb.silence();
    expect(lb.de('donnees')).toHaveLength(0);
  });

  test('les journaux ne gardent ni la charge, ni les jetons, ni les clés', async () => {
    const c = ici();
    const a = await membre('chris');
    const b = await membre('chris');
    const la = await lien(a);
    const lb = await lien(b);
    la.envoyer({ t: 'ouvrir', canal: 'j1', vers: b.id });
    await lb.attendre((m) => m['t'] === 'ouvrir');
    lb.envoyer({ t: 'accepter', canal: 'j1' });
    await la.attendre((m) => m['t'] === 'accepter');
    la.envoyer({ t: 'donnees', canal: 'j1', charge: 'SECRET-CHARGE-4242' });
    await lb.attendre((m) => m['t'] === 'donnees');
    const journal = c.lignes.join('');
    expect(journal).toContain('canal');
    expect(journal).not.toContain('SECRET-CHARGE-4242');
    expect(journal).not.toContain(a.jeton);
    expect(journal).not.toContain(b.jeton);
  });
});

describe('présence entre propriétaires : seulement après canal accepté', () => {
  type Identite = { readonly id: string; readonly jeton: string };
  interface Monde {
    readonly a1: Identite;
    readonly a2: Identite;
    readonly a3: Identite;
    readonly b1: Identite;
    readonly la1: Lien;
    readonly la2: Lien;
    readonly la3: Lien;
    readonly lb1: Lien;
  }

  /** Chris : trois nœuds (A1, A2, A3) ; Mathéo : un nœud (B1) ; lien duo déclaré ; tous connectés. */
  async function mondeDuo(): Promise<Monde> {
    executerCommande(['lier-duo', 'matheo', 'chris'], ici().annuaire);
    const a1 = await membre('chris');
    const a2 = await membre('chris');
    const a3 = await membre('chris');
    const b1 = await membre('matheo');
    const la1 = await lien(a1);
    const la2 = await lien(a2);
    const la3 = await lien(a3);
    const lb1 = await lien(b1);
    await lb1.silence();
    return { a1, a2, a3, b1, la1, la2, la3, lb1 };
  }

  /** Identifiants de la dernière présence reçue, triés. */
  function visibles(l: Lien): string[] {
    const membres = (l.de('presence').at(-1)?.['membres'] ?? []) as { id: string }[];
    return membres.map((x) => x.id).sort();
  }

  async function accepterCanal(m: Monde, canal: string): Promise<void> {
    m.lb1.envoyer({ t: 'ouvrir', canal, vers: m.a1.id });
    await m.la1.attendre((x) => x.t === 'ouvrir' && x['canal'] === canal);
    m.la1.envoyer({ t: 'accepter', canal });
    await m.lb1.attendre((x) => x.t === 'accepter' && x['canal'] === canal);
    await m.lb1.silence();
  }

  test('avant tout canal accepté : Mathéo ne voit aucun nœud de Chris, Chris voit ses trois nœuds', async () => {
    const m = await mondeDuo();
    expect(visibles(m.lb1)).toEqual([]);
    expect(visibles(m.la1)).toEqual([m.a2.id, m.a3.id].sort());
  });

  test('après acceptation avec A1 : Mathéo ne voit que A1, et Chris voit B1 chez A1 seulement', async () => {
    const m = await mondeDuo();
    await accepterCanal(m, 'duo1');
    expect(visibles(m.lb1)).toEqual([m.a1.id]);
    expect(visibles(m.la1)).toEqual([m.a2.id, m.a3.id, m.b1.id].sort());
    expect(visibles(m.la2)).toEqual([m.a1.id, m.a3.id].sort());
  });

  test('révocation de A1 : il disparaît de la présence de Mathéo, sans nouvelle connexion', async () => {
    const m = await mondeDuo();
    await accepterCanal(m, 'duo2');
    executerCommande(['revoquer', m.a1.id], ici().annuaire);
    ici().aiguilleur.balayer();
    await m.lb1.silence();
    expect(visibles(m.lb1)).toEqual([]);
    expect(visibles(m.la2)).toEqual([m.a3.id]);
  });

  test('un nœud de Chris hors ligne ne répond pas autrement qu’un inconnu à Mathéo', async () => {
    const m = await mondeDuo();
    const horsLigne = await membre('chris');
    m.lb1.envoyer({ t: 'ouvrir', canal: 'duo3', vers: horsLigne.id });
    expect((await m.lb1.attendre((x) => x.t === 'erreur')).motif).toBe('non-autorise');
  });

  test('appairage duo possible avant tout canal accepté ; Mathéo ne voit toujours aucun nœud de Chris', async () => {
    const m = await mondeDuo();
    m.lb1.envoyer({ t: 'ouvrir', canal: 'duo4', vers: m.a1.id });
    expect((await m.la1.attendre((x) => x.t === 'ouvrir' && x['canal'] === 'duo4'))['de']).toBe(m.b1.id);
    await m.lb1.silence();
    expect(visibles(m.lb1)).toEqual([]);
    expect(visibles(m.la1)).toEqual([m.a2.id, m.a3.id].sort());
  });
});
