// Responsabilité : banc du téléphone chef sur deux nœuds reliés par l'aiguilleur réel — un vrai appareil, appairé
// au nœud A (chef de la charte), y est nommé chef puis parle au nœud B : une charte qu'il signe est adoptée par B
// et relayée à A ; un téléphone non chef est refusé ; un ordre pause signé agit sur A ; rejoué ou d'un non-chef,
// refusé. Commandes des machines factices : aucun arrêt réel.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { changerMembre, nommerChef, signerCharte, TOUS_DROITS } from '../../commun/charte.ts';
import { signerOrdre, type OrdreMachine } from '../../commun/ordre-machine.ts';
import type { CanalNoeud } from './canal.ts';
import { type Appareil, appareilAvecCode, PROPRIETAIRE } from './banc-appareil.ts';
import { attendre, creerNoeud, monterAiguilleur, type Monte, type Noeud, relier } from './banc-federation.ts';

const PREFIXE = '/api/reseau/telephone';
const COMMANDES_FACTICES = {
  nvidiaSmi: ['/chemin/inexistant/nvidia-smi-factice'],
  extinction: ['true'],
  redemarrage: ['true'],
};

interface Monde {
  readonly a: Noeud;
  readonly b: Noeud;
  readonly idA: string;
  readonly idB: string;
}

let monte: Monte;
let noeuds: Noeud[] = [];
/** Identifiant de canal unique par ouverture (le banc de l'appareil en fixe un, qui se heurte au 2e téléphone). */
let rang = 0;

beforeEach(() => {
  monte = monterAiguilleur();
  noeuds = [];
});

afterEach(() => {
  for (const n of noeuds) n.federation.arreter();
  monte.serveur.stop(true);
});

async function nouveau(nom: string, options: Parameters<typeof creerNoeud>[1] = {}): Promise<Noeud> {
  const n = creerNoeud(nom, { commandes: COMMANDES_FACTICES, ...options });
  noeuds.push(n);
  await relier(n, monte, PROPRIETAIRE);
  return n;
}

async function idDe(n: Noeud): Promise<string> {
  const id = (await n.federation.etat()).aiguilleur?.id;
  if (!id) throw new Error('nœud non relié');
  return id;
}

async function enLignePour(vu: Noeud, cible: string): Promise<void> {
  await attendre(async () => (await vu.federation.etat()).membres.some((m) => m.id === cible && m.enLigne));
}

/** Appairage de A vers B : Chris accepte chez B, le lien chiffré s'ouvre des deux côtés. */
async function appairer(a: Noeud, b: Noeud): Promise<{ idA: string; idB: string }> {
  const idA = await idDe(a);
  const idB = await idDe(b);
  await enLignePour(a, idB);
  expect(a.federation.appairer(idB).ok).toBe(true);
  await attendre(async () => (await b.federation.etat()).demandes.length === 1);
  const demande = (await b.federation.etat()).demandes[0];
  b.federation.decider(demande?.id ?? '', true);
  await attendre(async () => (await a.federation.etat()).noeuds.some((n) => n.id === idB && n.liaisonOuverte));
  return { idA, idB };
}

/** A est le nœud où le réseau est fondé (reprise), B le nœud qui l'adopte. */
async function monterMonde(): Promise<Monde> {
  const a = await nouveau('portable', { peutReprendre: true });
  const b = await nouveau('tour');
  const { idA, idB } = await appairer(a, b);
  await attendre(() => b.federation.charte.charte() !== null);
  return { a, b, idA, idB };
}

async function synchroniser(m: Monde): Promise<void> {
  await attendre(() => {
    const version = m.a.federation.charte.charte()?.version;
    return version !== undefined && m.b.federation.charte.charte()?.version === version;
  });
}

/** Un appareil appairé à A : Chris accepte sa demande (la décision est simulée ici). */
async function appairerA(m: Monde): Promise<Appareil> {
  const appareil = await appareilAvecCode(monte);
  rang += 1;
  const canal = `ap-${rang}`;
  appareil.ouvrir(canal, m.idA, 'appairage');
  const trouvee = async (): Promise<boolean> =>
    (await m.a.federation.etat()).demandes.some((d) => d.membre === appareil.membre);
  await attendre(trouvee);
  const demande = (await m.a.federation.etat()).demandes.find((d) => d.membre === appareil.membre);
  m.a.federation.decider(demande?.id ?? '', true);
  await attendre(() => appareil.ouverts.includes(canal));
  return appareil;
}

/** Un téléphone appairé à A ; nommé chef si demandé ; ouvert vers B une fois B synchronisé sur la charte. */
async function telephone(m: Monde, chef: boolean): Promise<{ tel: Appareil; canal: CanalNoeud }> {
  const tel = await appairerA(m);
  if (chef) {
    const r = await m.a.federation.charte.editer((c, moi, le) => nommerChef(c, moi, tel.membre, true, le));
    expect(r.ok).toBe(true);
  }
  await synchroniser(m);
  rang += 1;
  const id = `b-${rang}`;
  const canal = tel.ouvrir(id, m.idB, 'appairage');
  await attendre(() => tel.ouverts.includes(id));
  return { tel, canal };
}

async function ordreDe(tel: Appareil, m: Monde, action: OrdreMachine['action']) {
  const reseau = m.b.federation.charte.charte()?.reseau;
  if (reseau === undefined) throw new Error('charte absente');
  const ordre: OrdreMachine = {
    format: 1,
    reseau,
    cible: m.idA,
    action,
    par: tel.membre,
    le: new Date().toISOString(),
    nonce: randomUUID().replaceAll('-', ''),
  };
  return { ordre: await signerOrdre(ordre, tel.identite.signaturePrivee) };
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('téléphone chef, charte et ordres', () => {
  test('le téléphone chef signe une charte v+1 posée à B : B la relaie, A l’adopte', async () => {
    const m = await monterMonde();
    const { tel, canal } = await telephone(m, true);
    const base = m.b.federation.charte.charte();
    if (base === null) throw new Error('charte absente');
    const droits = { ...TOUS_DROITS, piloter: false };
    const edition = changerMembre(base, tel.membre, m.idB, { droits }, new Date().toISOString());
    if (!edition.ok) throw new Error(edition.raison);
    const signee = await signerCharte(edition.charte, tel.identite.signaturePrivee);
    const r = await tel.appeler(canal, `${PREFIXE}/charte`, {
      methode: 'POST',
      corps: JSON.stringify({ texte: signee.texte, signature: signee.signature }),
    });
    expect(r.statut).toBe(200);
    await attendre(() => m.a.federation.charte.charte()?.version === base.version + 1);
    expect(m.a.federation.charte.charte()?.membres.find((x) => x.id === m.idB)?.droits.piloter).toBe(false);
  });

  test('un téléphone non chef : 403, aucune version nouvelle chez B ni chez A', async () => {
    const m = await monterMonde();
    const { tel, canal } = await telephone(m, false);
    const base = m.b.federation.charte.charte();
    if (base === null) throw new Error('charte absente');
    const forgee = { ...base, version: base.version + 1, par: tel.membre };
    const signee = await signerCharte(forgee, tel.identite.signaturePrivee);
    const r = await tel.appeler(canal, `${PREFIXE}/charte`, {
      methode: 'POST',
      corps: JSON.stringify({ texte: signee.texte, signature: signee.signature }),
    });
    expect(r.statut).toBe(403);
    await pause(300);
    expect(m.b.federation.charte.charte()?.version).toBe(base.version);
    expect(m.a.federation.charte.charte()?.version).toBe(base.version);
  });

  test('un ordre pause signé par le chef, posé à B pour A : A en pause ; rejoué, refusé', async () => {
    const m = await monterMonde();
    const { tel, canal } = await telephone(m, true);
    const corps = JSON.stringify(await ordreDe(tel, m, 'pause'));
    const chemin = `${PREFIXE}/machines/${m.idA}/action`;
    expect((await tel.appeler(canal, chemin, { methode: 'POST', corps })).statut).toBe(200);
    await attendre(() => m.a.federation.enPause());
    expect((await tel.appeler(canal, chemin, { methode: 'POST', corps })).statut).toBe(403);
  });

  test('un ordre signé par un téléphone non chef : refusé, A reste actif', async () => {
    const m = await monterMonde();
    const chef = await telephone(m, true);
    const membre = await telephone(m, false);
    const corps = JSON.stringify(await ordreDe(membre.tel, m, 'pause'));
    const r = await membre.tel.appeler(membre.canal, `${PREFIXE}/machines/${m.idA}/action`, { methode: 'POST', corps });
    expect(r.statut).toBe(403);
    await pause(300);
    expect(m.a.federation.enPause()).toBe(false);
    expect(chef.tel.membre).not.toBe(membre.tel.membre);
  });
});
