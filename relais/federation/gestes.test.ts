// Forme des gestes relayés : lecture de la route (session, machine, nœud) et réponse réduite (texte, binaire).
import { describe, expect, test } from 'bun:test';
import { TAILLE_MAX_TRANSFERT_CARACTERES } from '../../commun/federation.ts';
import { typeDevine } from './distantes.ts';
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

  test('une page HTML garde son type (sinon l’appli d’en face la croit JSON et l’aperçu reste blanc)', async () => {
    const page = '<!doctype html><h1>Carte</h1>';
    const html = await reponseGeste(
      new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      'fichiers/f1',
    );
    expect(html).toEqual({ statut: 200, corps: page, type: 'text/html; charset=utf-8' });
  });

  test('un texte entier reste entier jusqu’au plus grand transfert ; au-delà, refus 413', async () => {
    const gros = JSON.stringify('x'.repeat(700_000));
    const entier = await reponseGeste(new Response(gros), 'contenu');
    expect(entier).toEqual({ statut: 200, corps: gros });
    const trop = await reponseGeste(new Response('x'.repeat(TAILLE_MAX_TRANSFERT_CARACTERES + 1)), 'contenu');
    expect(trop.statut).toBe(413);
  });

  test('liste d’évènements au-delà du plus grand transfert : les plus anciens partent', async () => {
    const liste = JSON.stringify(Array.from({ length: 90_000 }, (_, i) => ({ i, texte: 'y'.repeat(200) })));
    const reduite = await reponseGeste(new Response(liste), 'evenements');
    expect(reduite.statut).toBe(200);
    expect(reduite.corps.length).toBeLessThanOrEqual(TAILLE_MAX_TRANSFERT_CARACTERES);
    expect(JSON.parse(reduite.corps).at(-1).i).toBe(89_999);
  });
});

describe('typeDevine (pair sans type)', () => {
  test('une page présentée est reconnue ; le reste garde le JSON', () => {
    expect(typeDevine('fichiers/f1', '  <!DOCTYPE html><p>x</p>')).toBe('text/html; charset=utf-8');
    expect(typeDevine('fichiers/f1', '# Titre')).toBe('text/plain; charset=utf-8');
    expect(typeDevine('fichiers/f1', '{"a":1}')).toBe('application/json');
    expect(typeDevine('fil', '<!doctype html>')).toBe('application/json');
  });
});
