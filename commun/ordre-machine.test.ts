// Responsabilité : tests de l'ordre signé d'un chef — les sept motifs de refus, l'ordre accepté, le rejeu, et
// l'expiration du registre des nonces.
import { describe, expect, test } from 'bun:test';
import { ajouterMembre, creerCharte, type Charte, TOUS_DROITS } from './charte.ts';
import { exporterIdentitePublique, genererIdentite, type Identite } from './chiffrement/identite.ts';
import { OrdreSigne } from './federation.ts';
import { NoncesVus, type OrdreMachine, signerOrdre, verifierOrdre } from './ordre-machine.ts';

const RESEAU = '111111111111';
const CHEF = 'aaaaaaaaaaaa';
const AUTRE = 'bbbbbbbbbbbb';
const CIBLE = 'cccccccccccc';
const MAINTENANT = Date.parse('2026-11-22T10:00:00.000Z');
const LE = new Date(MAINTENANT).toISOString();
const NONCE = 'a'.repeat(32);

interface Monde {
  readonly charte: Charte;
  readonly chef: Identite;
  readonly autre: Identite;
}

async function monde(): Promise<Monde> {
  const chef = await genererIdentite();
  const autre = await genererIdentite();
  const base = creerCharte({
    reseau: RESEAU,
    nom: 'Test',
    moi: { id: CHEF, nom: 'chef', identite: exporterIdentitePublique(chef.publique) },
    le: LE,
  });
  const charte = ajouterMembre(
    base,
    CHEF,
    {
      id: AUTRE,
      nom: 'autre',
      sorte: 'pair',
      identite: exporterIdentitePublique(autre.publique),
      droits: TOUS_DROITS,
      compte: null,
    },
    LE,
  );
  if (!charte.ok) throw new Error(charte.raison);
  return { charte: charte.charte, chef, autre };
}

function ordreDe(extra: Partial<OrdreMachine> = {}): OrdreMachine {
  return { format: 1, reseau: RESEAU, cible: CIBLE, action: 'pause', par: CHEF, le: LE, nonce: NONCE, ...extra };
}

async function signe(ordre: OrdreMachine, cle: Identite) {
  return signerOrdre(ordre, cle.signaturePrivee);
}

function attendu(nonces = new NoncesVus(), maintenantMs = MAINTENANT) {
  return { cible: CIBLE, maintenantMs, nonces };
}

describe('verifierOrdre', () => {
  test('un ordre signé par le chef, pour la cible, frais : accepté', async () => {
    const m = await monde();
    const r = await verifierOrdre(m.charte, await signe(ordreDe(), m.chef), attendu());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ordre.action).toBe('pause');
  });

  test('le même ordre une seconde fois : rejoué', async () => {
    const m = await monde();
    const nonces = new NoncesVus();
    const s = await signe(ordreDe(), m.chef);
    expect((await verifierOrdre(m.charte, s, attendu(nonces))).ok).toBe(true);
    expect(await verifierOrdre(m.charte, s, attendu(nonces))).toEqual({ ok: false, motif: 'rejoue' });
  });

  test('pas de charte : non-chef', async () => {
    const m = await monde();
    const s = await signe(ordreDe(), m.chef);
    expect(await verifierOrdre(null, s, attendu())).toEqual({ ok: false, motif: 'non-chef' });
  });

  test('texte qui n’est pas un ordre : illisible', async () => {
    const m = await monde();
    const brut = { texte: 'pas du json', signature: 'A'.repeat(86) };
    expect(await verifierOrdre(m.charte, OrdreSigne.parse(brut), attendu())).toEqual({ ok: false, motif: 'illisible' });
  });

  test('autre réseau : autre-reseau', async () => {
    const m = await monde();
    const s = await signe(ordreDe({ reseau: '222222222222' }), m.chef);
    expect(await verifierOrdre(m.charte, s, attendu())).toEqual({ ok: false, motif: 'autre-reseau' });
  });

  test('autre cible que celle attendue : cible', async () => {
    const m = await monde();
    const s = await signe(ordreDe({ cible: 'dddddddddddd' }), m.chef);
    expect(await verifierOrdre(m.charte, s, attendu())).toEqual({ ok: false, motif: 'cible' });
  });

  test('signé par un membre qui n’est pas chef : non-chef', async () => {
    const m = await monde();
    const s = await signe(ordreDe({ par: AUTRE }), m.autre);
    expect(await verifierOrdre(m.charte, s, attendu())).toEqual({ ok: false, motif: 'non-chef' });
  });

  test('chef désigné mais signé avec une autre clé : signature', async () => {
    const m = await monde();
    const intrus = await genererIdentite();
    const s = await signe(ordreDe(), intrus);
    expect(await verifierOrdre(m.charte, s, attendu())).toEqual({ ok: false, motif: 'signature' });
  });

  test('ordre vieux de plus de 2 min : perime', async () => {
    const m = await monde();
    const s = await signe(ordreDe(), m.chef);
    expect(await verifierOrdre(m.charte, s, attendu(new NoncesVus(), MAINTENANT + 121_000))).toEqual({
      ok: false,
      motif: 'perime',
    });
  });
});

describe('NoncesVus', () => {
  test('un nonce est gardé pendant sa durée, puis oublié', () => {
    const nonces = new NoncesVus(1000);
    nonces.noter(NONCE, 0);
    expect(nonces.vu(NONCE, 999)).toBe(true);
    expect(nonces.vu(NONCE, 1000)).toBe(false);
  });
});
