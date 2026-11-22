// Gros contenus entre nœuds : texte, envoi de pièces, fichier binaire, refus au-delà du plus grand transfert, lien
// coupé en plein transfert puis relance. Deux nœuds réels sur un aiguilleur réel.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TAILLE_MAX_TRANSFERT_CARACTERES } from '../../commun/federation.ts';
import { attendre } from './banc-federation.ts';
import {
  arreterBanc,
  demarrerBanc,
  idDe,
  nouveau,
  requete,
  SESSION_A,
  sessionVue,
} from './parite-banc.ts';

beforeEach(() => demarrerBanc());
afterEach(() => arreterBanc());

describe('gros contenus entre nœuds', () => {
  test('un texte de 1,5 million de caractères arrive entier, en morceaux', async () => {
    const gros = 'é'.repeat(1_500_000);
    const a = await nouveau('tour', (g) => (g.geste === 'contenu' ? Response.json({ texte: gros }) : undefined));
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const avant = a.charges.length;
    const r = await b.federation.distantes.intercepter(requete(`/api/sessions/${SESSION_A}/contenu?chemin=grand.md`));
    expect(r?.status).toBe(200);
    expect(((await r?.json()) as { texte: string }).texte).toBe(gros);
    expect(a.charges.length - avant).toBeGreaterThan(10);
  });

  test('un envoi de 2,5 Mo (pièce jointe) arrive entier au nœud qui tient la session', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const corps = JSON.stringify({ texte: 'voici', pieces: [{ nom: 'gros.bin', contenu: 'A'.repeat(2_500_000) }] });
    const r = await b.federation.distantes.intercepter(requete(`/api/sessions/${SESSION_A}/messages`, 'POST', corps));
    expect(r?.status).toBe(200);
    expect(a.appels.gestes.at(-1)?.corps).toBe(corps);
  });

  test('au-delà du plus grand transfert : refus 413, rien ne part', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const trop = 'x'.repeat(TAILLE_MAX_TRANSFERT_CARACTERES + 1);
    const r = await b.federation.distantes.intercepter(requete(`/api/sessions/${SESSION_A}/contenu`, 'PUT', trop));
    expect(r?.status).toBe(413);
    expect(a.appels.gestes).toEqual([]);
  });

  test('un fichier binaire de 3 Mo arrive octet pour octet, avec son type', async () => {
    const octets = new Uint8Array(3_000_000).map((_, i) => i % 251);
    const a = await nouveau('tour', (g) =>
      g.geste === 'fichiers/f1' ? new Response(octets, { headers: { 'content-type': 'image/png' } }) : undefined,
    );
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const r = await b.federation.distantes.intercepter(requete(`/api/sessions/${SESSION_A}/fichiers/f1?telecharger=1`));
    expect(r?.headers.get('content-type')).toBe('image/png');
    const recu = Buffer.from(await r!.arrayBuffer());
    expect(Buffer.compare(recu, Buffer.from(octets))).toBe(0);
  });

  test('lien coupé en plein transfert : la demande échoue tout de suite, la relance réussit', async () => {
    let appels = 0;
    const a = await nouveau('tour', (g) => {
      if (g.geste !== 'contenu') return undefined;
      appels += 1;
      return appels === 1 ? new Promise<Response>(() => undefined) : Response.json({ texte: 'relancé' });
    });
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const idA = await idDe(a);
    const debut = Date.now();
    const en_cours = b.federation.distantes.intercepter(requete(`/api/sessions/${SESSION_A}/contenu?chemin=x.md`));
    await attendre(() => appels === 1);
    a.federation.arreter();
    const coupee = await en_cours;
    expect(coupee?.status).toBe(504);
    expect(Date.now() - debut).toBeLessThan(5000);
    a.federation.demarrer();
    await attendre(() => b.federation.distantes.membreDe(SESSION_A) !== null);
    await attendre(async () => (await b.federation.etat()).noeuds.some((n) => n.id === idA && n.liaisonOuverte), 8000);
    const relire = requete(`/api/sessions/${SESSION_A}/contenu?chemin=x.md`);
    const relancee = await b.federation.distantes.intercepter(relire);
    expect(relancee?.status).toBe(200);
    expect(await relancee?.json()).toEqual({ texte: 'relancé' });
  });
});
