// Forme des gestes relayés : lecture de la route (session, machine, nœud) et réponse réduite (texte, binaire).
import { describe, expect, test } from 'bun:test';
import { lireRoute, reponseGeste } from './gestes.ts';

describe('lireRoute', () => {
  test('session et machine : identifiant, suffixe, méthode et requête (sans attente)', () => {
    expect(lireRoute(new URL('http://x/api/sessions/s1/git/diff?chemin=a.md&attendre=30'), 'GET')).toEqual({
      portee: 'session',
      id: 's1',
      geste: 'git/diff',
      methode: 'GET',
      requete: 'chemin=a.md',
    });
    expect(lireRoute(new URL('http://x/api/machines/tour/dossiers'), 'GET')).toEqual({
      portee: 'machine',
      id: 'tour',
      geste: 'dossiers',
      methode: 'GET',
    });
  });

  test('autre route ou méthode non transportée : null', () => {
    expect(lireRoute(new URL('http://x/api/etat'), 'GET')).toBeNull();
    expect(lireRoute(new URL('http://x/api/sessions/s1/contenu'), 'DELETE')).toBeNull();
  });
});

describe('reponseGeste', () => {
  test('texte : corps tel quel ; binaire : base64 et type MIME', async () => {
    const texte = await reponseGeste(Response.json({ ok: true }), 'contenu');
    expect(texte).toEqual({ statut: 200, corps: '{"ok":true}' });
    const octets = new Uint8Array([0, 255, 16, 65]);
    const binaire = await reponseGeste(
      new Response(octets, { headers: { 'content-type': 'image/png' } }),
      'fichiers/f1',
    );
    expect(binaire).toEqual({
      statut: 200,
      corps: Buffer.from(octets).toString('base64'),
      type: 'image/png',
      codage: 'base64',
    });
  });

  test('texte trop grand : 502 lisible ; liste d’évènements : les plus anciens partent', async () => {
    const grand = JSON.stringify('x'.repeat(700_000));
    const refus = await reponseGeste(new Response(grand), 'contenu');
    expect(refus.statut).toBe(502);
    const liste = JSON.stringify(Array.from({ length: 4000 }, (_, i) => ({ i, texte: 'y'.repeat(200) })));
    const reduite = await reponseGeste(new Response(liste), 'evenements');
    expect(reduite.statut).toBe(200);
    expect(JSON.parse(reduite.corps).at(-1).i).toBe(3999);
  });
});
