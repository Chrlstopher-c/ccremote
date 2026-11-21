// Responsabilité : tests de l'étape 2 « écrire à deux » — message et interruption du pair chez le propriétaire, droits
// (lecture seule, accord en « ignorer les permissions »), refus, expiration, journal, nom affiché.
/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test';
import { DROITS_PAR_DEFAUT, texteRemisAClaude } from '../../commun/duo.ts';
import { attendre, type Banc, creerBanc, deuxBancs, ficheOuverte, poster } from './banc-duo.ts';
import { choisirEcoute } from './ecoute.ts';

const bancs: Banc[] = [];
afterEach(() => {
  for (const b of bancs.splice(0)) b.duo.arreter();
});

async function duo(options: Parameters<typeof deuxBancs>[0] = {}): Promise<{ a: Banc; b: Banc }> {
  const { a, b } = await deuxBancs(options);
  bancs.push(a, b);
  return { a, b };
}

function partagerSession(a: Banc, b: Banc, id: string, niveau: 'lecture' | 'ecriture', mode?: 'default'): void {
  poster(a, { kind: 'session', session: ficheOuverte(id, '/p1', mode) });
  a.duo.partager({ cible: id, genre: 'session', niveau });
  void b;
}

async function attendreSession(b: Banc, id: string): Promise<void> {
  await attendre(() => b.registre.session(id) !== null);
}

const commandesEnvoi = (a: Banc): Record<string, unknown>[] => a.commandes.filter((c) => c['kind'] === 'envoyer');

describe('écrire à deux', () => {
  test('message dans une session partagée en écriture : envoyé avec son auteur, texte remis préfixé', async () => {
    const { a, b } = await duo();
    partagerSession(a, b, 's2', 'ecriture', 'default');
    await attendreSession(b, 's2');
    const r = await b.duo.ecrireAPair('s2', 'bonjour', []);
    expect(r).toEqual({ ok: true, valeur: null });
    expect(commandesEnvoi(a)).toEqual([
      expect.objectContaining({ kind: 'envoyer', sessionId: 's2', texte: 'bonjour', auteur: 'bob' }),
    ]);
    expect(texteRemisAClaude('bob', 'bonjour')).toBe('[Message de bob]\nbonjour');
    expect(a.duo.journalDuo()[0]).toMatchObject({ qui: 'bob', action: 'ecrire', cible: 's2', detail: 'envoyé' });
  });

  test('nom affiché du pair : signé, préfixé et journalisé sous ce nom', async () => {
    const { a, b } = await duo();
    b.duo.majNom('Nina');
    await attendre(() => a.duo.etat().pair?.nom === 'Nina');
    partagerSession(a, b, 's2', 'ecriture', 'default');
    await attendreSession(b, 's2');
    expect(b.registre.session('s2')?.duo).toEqual({ pair: 'alice', nom: 'alice', niveau: 'ecriture' });
    await b.duo.ecrireAPair('s2', 'salut', []);
    expect(commandesEnvoi(a)[0]).toMatchObject({ auteur: 'Nina' });
    expect(a.duo.journalDuo()[0]).toMatchObject({ qui: 'Nina' });
  });

  test('session partagée en lecture seule : refusée côté propriétaire', async () => {
    const { a, b } = await duo();
    partagerSession(a, b, 's2', 'lecture', 'default');
    await attendreSession(b, 's2');
    const r = await b.duo.ecrireAPair('s2', 'bonjour', []);
    expect(r).toMatchObject({ ok: false, raison: 'partagée en lecture seule' });
    expect(commandesEnvoi(a)).toEqual([]);
  });

  test('session sans permissions + demander : demande, accord → envoyé', async () => {
    const { a, b } = await duo();
    partagerSession(a, b, 's2', 'ecriture');
    await attendreSession(b, 's2');
    const attente = b.duo.ecrireAPair('s2', 'vas-y', []);
    await attendre(() => a.duo.listerDemandes().length === 1);
    const demande = a.duo.listerDemandes()[0];
    expect(demande).toMatchObject({ genre: 'message', de: 'bob', detail: 'vas-y' });
    expect(a.duo.decider(demande?.id ?? '', true)).toBe(true);
    expect(await attente).toEqual({ ok: true, valeur: null });
    expect(commandesEnvoi(a)).toHaveLength(1);
  });

  test('session sans permissions + demander : refus → « refusé par alice »', async () => {
    const { a, b } = await duo();
    partagerSession(a, b, 's2', 'ecriture');
    await attendreSession(b, 's2');
    const attente = b.duo.ecrireAPair('s2', 'non', []);
    await attendre(() => a.duo.listerDemandes().length === 1);
    a.duo.decider(a.duo.listerDemandes()[0]?.id ?? '', false);
    expect(await attente).toMatchObject({ ok: false, raison: 'refusé par alice' });
    expect(commandesEnvoi(a)).toEqual([]);
    expect(a.duo.journalDuo()[0]?.detail).toContain('pas d’accord');
  });

  test('session sans permissions + demander : expiration → « refusé par alice »', async () => {
    const { a, b } = await duo({ delaiDemandeMs: 30 });
    partagerSession(a, b, 's2', 'ecriture');
    await attendreSession(b, 's2');
    const r = await b.duo.ecrireAPair('s2', 'trop tard', []);
    expect(r).toMatchObject({ ok: false, raison: 'refusé par alice' });
    expect(a.duo.listerDemandes()).toEqual([]);
  });

  test('accepter : envoyé sans demande en session sans permissions', async () => {
    const { a, b } = await duo();
    a.duo.majDroits({ ...DROITS_PAR_DEFAUT, ecrireSansPermissions: 'accepter' });
    partagerSession(a, b, 's2', 'ecriture');
    await attendreSession(b, 's2');
    expect(await b.duo.ecrireAPair('s2', 'direct', [])).toEqual({ ok: true, valeur: null });
    expect(a.duo.listerDemandes()).toEqual([]);
  });

  test('session non partagée : refusée côté propriétaire même si le pair l’envoie quand même', async () => {
    const { a, b } = await duo();
    poster(a, { kind: 'session', session: ficheOuverte('secrete', '/p1') });
    const r = await b.duo.ecrireAPair('secrete', 'intrusion', []);
    expect(r).toMatchObject({ ok: false, raison: 'session non partagée avec vous' });
    expect(commandesEnvoi(a)).toEqual([]);
    expect(a.duo.journalDuo()[0]).toMatchObject({
      qui: 'bob',
      cible: 'secrete',
      detail: 'refusé : session non partagée avec vous',
    });
  });

  test('interruption : passe le lien sur une session partagée en écriture, refusée en lecture', async () => {
    const { a, b } = await duo();
    partagerSession(a, b, 's2', 'ecriture', 'default');
    partagerSession(a, b, 's3', 'lecture', 'default');
    await attendreSession(b, 's2');
    await attendreSession(b, 's3');
    expect(await b.duo.interrompreAPair('s2')).toEqual({ ok: true, valeur: null });
    expect(a.commandes.some((c) => c['kind'] === 'interrompre' && c['sessionId'] === 's2')).toBe(true);
    expect(await b.duo.interrompreAPair('s3')).toMatchObject({ ok: false, raison: 'partagée en lecture seule' });
  });

  test('pair non connecté : refus sans attente', async () => {
    const { a, b } = await duo();
    b.duo.couperLien();
    await attendre(() => b.duo.etat().etat !== 'connecte');
    a.duo.arreter();
    expect(await b.duo.ecrireAPair('s2', 'seul', [])).toMatchObject({ ok: false, statut: 409 });
  });
});

describe('écoute du lien', () => {
  test('sans variable : la première interface wg* en IPv4, sinon la boucle locale', () => {
    const reseau = {
      lo: [{ family: 'IPv4', address: '127.0.0.1' }],
      wg0: [{ family: 'IPv6', address: '2001:db8::2' }],
      wg1: [{ family: 'IPv4', address: '203.0.113.7' }],
      eth0: [{ family: 'IPv4', address: '203.0.113.5' }],
    };
    expect(choisirEcoute(reseau)).toBe('203.0.113.7');
    expect(choisirEcoute({ lo: [{ family: 'IPv4', address: '127.0.0.1' }] })).toBe('127.0.0.1');
  });

  test('code d’appairage et état annoncent l’adresse d’écoute réelle', () => {
    const seul = creerBanc('solo');
    bancs.push(seul);
    const code = seul.duo.codeAppairage();
    expect(code).toMatchObject({ ok: true, valeur: { adresse: `127.0.0.1:${seul.duo.portEcoute}` } });
    expect(seul.duo.etat().ecoute).toBe(`127.0.0.1:${seul.duo.portEcoute}`);
  });
});
