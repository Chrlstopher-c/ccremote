import { describe, expect, test } from 'bun:test';
import { CorrelateurReponses, ErreurDelaiCorrelateur } from './correlateur.ts';

describe('CorrelateurReponses', () => {
  test('résout attendre() avec la réponse corrélée par id', async () => {
    const correlateur = new CorrelateurReponses<{ valeur: string }>();
    const id = correlateur.nouvelId();
    const attente = correlateur.attendre(id, 1000);
    correlateur.resoudre(id, { valeur: 'ok' });
    expect(await attente).toEqual({ valeur: 'ok' });
  });

  test('rejette avec ErreurDelaiCorrelateur si rien n arrive dans le délai', async () => {
    const correlateur = new CorrelateurReponses<string>();
    const id = correlateur.nouvelId();
    await expect(correlateur.attendre(id, 10)).rejects.toBeInstanceOf(ErreurDelaiCorrelateur);
  });

  test('une résolution sur un id inconnu (jamais attendu, ou déjà résolu) ne plante jamais', () => {
    const correlateur = new CorrelateurReponses<string>();
    expect(() => correlateur.resoudre('id-fantome', 'x')).not.toThrow();
  });

  test('une résolution tardive après timeout est silencieusement ignorée (pas de double résolution)', async () => {
    const correlateur = new CorrelateurReponses<string>();
    const id = correlateur.nouvelId();
    const attente = correlateur.attendre(id, 5);
    await expect(attente).rejects.toBeInstanceOf(ErreurDelaiCorrelateur);
    expect(() => correlateur.resoudre(id, 'trop-tard')).not.toThrow();
  });

  test('plusieurs attentes concurrentes sont distinguées par id, jamais croisées', async () => {
    const correlateur = new CorrelateurReponses<string>();
    const idA = correlateur.nouvelId();
    const idB = correlateur.nouvelId();
    const attenteA = correlateur.attendre(idA, 1000);
    const attenteB = correlateur.attendre(idB, 1000);
    correlateur.resoudre(idB, 'reponse-b');
    correlateur.resoudre(idA, 'reponse-a');
    expect(await attenteA).toBe('reponse-a');
    expect(await attenteB).toBe('reponse-b');
  });

  test('enAttenteCount reflète les attentes en vol, purgées après résolution', async () => {
    const correlateur = new CorrelateurReponses<string>();
    const id = correlateur.nouvelId();
    const attente = correlateur.attendre(id, 1000);
    expect(correlateur.enAttenteCount()).toBe(1);
    correlateur.resoudre(id, 'x');
    await attente;
    expect(correlateur.enAttenteCount()).toBe(0);
  });
});
