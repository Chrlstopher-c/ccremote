// Nœud sans écran : l'aiguilleur range `sansEcran` dans la présence (nœuds seulement) et à l'appairage ; une base
// d'avant la colonne migre sans perte. Aiguilleur réel sur 127.0.0.1, base en mémoire ou fichier de test.
import { afterEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import pino from 'pino';
import { PlafondEchecs } from '../acces/plafond.ts';
import { codeAppairage, creerNoeud, monterAiguilleur } from '../federation/banc-federation.ts';
import { type Aiguilleur, creerAiguilleur } from './aiguilleur.ts';
import { Annuaire } from './annuaire.ts';
import { MIGRATIONS_ANNUAIRE, ouvrirAnnuaire } from './annuaire-base.ts';
import { executerCommande } from './commande.ts';

type Message = Record<string, unknown>;
interface Vu {
  readonly id: string;
  readonly enLigne: boolean;
  readonly genre?: string;
  readonly sansEcran?: boolean;
}
interface Banc {
  readonly port: number;
  readonly annuaire: Annuaire;
  readonly aiguilleur: Aiguilleur;
  readonly serveur: ReturnType<typeof Bun.serve>;
}

const journal = pino({ enabled: false });
const bancs: Banc[] = [];
const sockets: WebSocket[] = [];

afterEach(() => {
  for (const ws of sockets.splice(0)) ws.close();
  for (const b of bancs.splice(0)) b.serveur.stop(true);
});

function demarrer(): Banc {
  const annuaire = new Annuaire(ouvrirAnnuaire(':memory:'));
  const plafond = new PlafondEchecs(join(mkdtempSync(join(tmpdir(), 'sans-ecran-')), 'echecs.json'), journal);
  const aiguilleur = creerAiguilleur({ annuaire, journal, plafond });
  const serveur = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: aiguilleur.fetch, websocket: aiguilleur.websocket });
  const banc = { port: serveur.port ?? 0, annuaire, aiguilleur, serveur };
  bancs.push(banc);
  return banc;
}

/** Appairage par code (commande locale puis HTTP), avec les champs du corps donnés. */
async function appairer(banc: Banc, corps: Record<string, unknown>): Promise<{ id: string; jeton: string }> {
  const code = executerCommande(['appairer', 'chris'], banc.annuaire).split('\n')[0] ?? '';
  const cle = randomBytes(32).toString('base64url');
  const rep = await fetch(`http://127.0.0.1:${banc.port}/api/membres/appairer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, nom: 'essai', cle, ...corps }),
  });
  expect(rep.status).toBe(200);
  return (await rep.json()) as { id: string; jeton: string };
}

/** Un lien sortant authentifié : ses messages reçus, dans l'ordre. */
function ecouter(banc: Banc, jeton: string): Message[] {
  const recus: Message[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${banc.port}/aiguilleur`, { headers: { authorization: `Bearer ${jeton}` } });
  ws.onmessage = (e) => void recus.push(JSON.parse(String(e.data)) as Message);
  sockets.push(ws);
  return recus;
}

function dernierePresence(recus: Message[]): readonly Vu[] {
  const dernier = recus.filter((m) => m['t'] === 'presence').at(-1);
  return (dernier?.['membres'] as Vu[] | undefined) ?? [];
}

async function attendre(predicat: () => boolean): Promise<void> {
  const fin = Date.now() + 3000;
  while (!predicat()) {
    if (Date.now() > fin) throw new Error('délai dépassé');
    await Bun.sleep(10);
  }
}

describe('sans écran : présence', () => {
  test('un nœud sans écran est vu sansEcran vrai, un nœud avec écran faux, un appareil sans le champ', async () => {
    const banc = demarrer();
    const avecEcran = await appairer(banc, { genre: 'noeud', sansEcran: false });
    const tour = await appairer(banc, { genre: 'noeud', sansEcran: true });
    const telephone = await appairer(banc, { genre: 'appareil', sansEcran: true });
    ecouter(banc, avecEcran.jeton);
    ecouter(banc, tour.jeton);
    const recusTel = ecouter(banc, telephone.jeton);
    await attendre(() => {
      const vus = dernierePresence(recusTel);
      return vus.some((m) => m.id === avecEcran.id && m.enLigne) && vus.some((m) => m.id === tour.id && m.enLigne);
    });
    const vus = dernierePresence(recusTel);
    expect(vus.find((m) => m.id === avecEcran.id)).toMatchObject({ genre: 'noeud', sansEcran: false });
    expect(vus.find((m) => m.id === tour.id)).toMatchObject({ genre: 'noeud', sansEcran: true });
    expect(vus.find((m) => m.id === telephone.id) ?? {}).not.toHaveProperty('sansEcran');
  });
});

describe('sans écran : appairage avec le nœud', () => {
  test('un nœud qui rejoint avec sansEcran vrai est enregistré ainsi ; sans le champ, faux', async () => {
    const monte = monterAiguilleur();
    const tour = creerNoeud('tour');
    const portable = creerNoeud('portable');
    try {
      const rt = await tour.federation.rejoindreAiguilleur({
        url: monte.url,
        code: codeAppairage(monte, 'chris'),
        nom: 'tour',
        sansEcran: true,
      });
      const rp = await portable.federation.rejoindreAiguilleur({
        url: monte.url,
        code: codeAppairage(monte, 'chris'),
        nom: 'portable',
      });
      expect(rt.ok && monte.annuaire.membre(rt.valeur.id)?.sansEcran).toBe(true);
      expect(rp.ok && monte.annuaire.membre(rp.valeur.id)?.sansEcran).toBe(false);
    } finally {
      tour.federation.arreter();
      portable.federation.arreter();
      monte.serveur.stop(true);
    }
  });
});

describe('sans écran : migration de l’annuaire', () => {
  test('une base d’avant la colonne migre sans perte ; les membres existants sont sans écran faux', () => {
    const chemin = join(mkdtempSync(join(tmpdir(), 'annuaire-ancien-')), 'annuaire.db');
    const ancienne = new Database(chemin, { create: true });
    for (const sql of MIGRATIONS_ANNUAIRE.slice(0, 2)) ancienne.exec(sql);
    ancienne.exec('PRAGMA user_version = 2');
    ancienne.exec(
      `INSERT INTO membres (id, genre, nom, proprietaire, empreinte_cle, cree_le)
       VALUES ('aaaaaaaaaaaa', 'noeud', 'tour', 'chris', 'empreinte', '2026-01-01T00:00:00.000Z')`,
    );
    ancienne.close();

    const db = ouvrirAnnuaire(chemin);
    const annuaire = new Annuaire(db);
    expect(annuaire.membre('aaaaaaaaaaaa')).toMatchObject({ nom: 'tour', proprietaire: 'chris', sansEcran: false });
    annuaire.creerMembre({
      id: 'bbbbbbbbbbbb',
      genre: 'noeud',
      nom: 'tour2',
      proprietaire: 'chris',
      empreinteCle: 'cle',
      jetonEmpreinte: 'jeton',
      sansEcran: true,
    });
    expect(annuaire.membre('bbbbbbbbbbbb')?.sansEcran).toBe(true);
    const version = db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version;
    expect(version).toBe(MIGRATIONS_ANNUAIRE.length);
    db.close();
  });
});
