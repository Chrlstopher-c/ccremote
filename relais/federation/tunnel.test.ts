// Tunnel chiffré entre deux bouts d'un vrai échange de poignée : ordre préservé même quand WebCrypto répond en
// désordre, rejeu et altération refusés, taille bornée.
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import { genererIdentite } from '../../commun/chiffrement/identite.ts';
import type { Canal } from '../../commun/chiffrement/messages.ts';
import { initierPoignee, repondrePoignee, terminerPoignee } from '../../commun/chiffrement/poignee.ts';
import { type MessageChiffre, TAILLE_MAX_CLAIR_OCTETS } from '../../commun/federation.ts';
import { Tunnel } from './tunnel.ts';

const journal = pino({ enabled: false });

async function deuxBouts(): Promise<{ a: Canal; b: Canal }> {
  const ia = await genererIdentite();
  const ib = await genererIdentite();
  const { message, attente } = await initierPoignee(ia, ib.publique, 'essai-tunnel');
  const { reponse, canal: b } = await repondrePoignee(ib, message, () => true);
  const a = await terminerPoignee(attente, reponse);
  return { a, b };
}

function trameDe(charge: string): string {
  const v = JSON.parse(charge) as { t: string; trame: string };
  return v.trame;
}

function attendreCycles(n = 5): Promise<void> {
  return new Promise((r) => setTimeout(r, n));
}

describe('tunnel chiffré entre nœuds', () => {
  test('une rafale part et arrive dans l’ordre d’envoi', async () => {
    const { a, b } = await deuxBouts();
    const emis = new Tunnel(a, journal);
    const recu = new Tunnel(b, journal);
    const charges: string[] = [];
    for (let i = 0; i < 30; i++) {
      const m: MessageChiffre = { t: 'reponse', ref: `r${i}`, ok: true };
      expect(emis.envoyer(m, (c) => charges.push(c))).toBe(true);
    }
    await attendreCycles();
    const ordre: string[] = [];
    for (const c of charges)
      recu.recevoir(
        trameDe(c),
        (m) => ordre.push(m.t === 'reponse' ? m.ref : '?'),
        () => ordre.push('KO'),
      );
    await attendreCycles();
    expect(ordre).toEqual(Array.from({ length: 30 }, (_, i) => `r${i}`));
  });

  test('une trame rejouée est refusée', async () => {
    const { a, b } = await deuxBouts();
    const charges: string[] = [];
    new Tunnel(a, journal).envoyer({ t: 'revocation' }, (c) => charges.push(c));
    await attendreCycles();
    const recu = new Tunnel(b, journal);
    const raisons: string[] = [];
    const trame = trameDe(charges[0] ?? '');
    recu.recevoir(
      trame,
      () => undefined,
      (r) => raisons.push(r),
    );
    recu.recevoir(
      trame,
      () => undefined,
      (r) => raisons.push(r),
    );
    await attendreCycles();
    expect(raisons).toEqual(['trame rejouée refusée']);
  });

  test('une trame altérée est refusée', async () => {
    const { a, b } = await deuxBouts();
    const charges: string[] = [];
    new Tunnel(a, journal).envoyer({ t: 'revocation' }, (c) => charges.push(c));
    await attendreCycles();
    const trame = trameDe(charges[0] ?? '');
    const abimee = `${trame.slice(0, -2)}${trame.endsWith('A') ? 'B' : 'A'}${trame.slice(-1)}`;
    const raisons: string[] = [];
    new Tunnel(b, journal).recevoir(
      abimee,
      () => undefined,
      (r) => raisons.push(r),
    );
    await attendreCycles();
    expect(raisons).toEqual(['trame altérée : authentification échouée']);
  });

  test('un message au-delà de la taille d’une trame n’est pas envoyé', async () => {
    const { a } = await deuxBouts();
    const trop = 'x'.repeat(TAILLE_MAX_CLAIR_OCTETS + 10);
    const envois: string[] = [];
    const ok = new Tunnel(a, journal).envoyer({ t: 'ecrire', ref: 'r', session: 's', texte: trop }, (c) =>
      envois.push(c),
    );
    expect(ok).toBe(false);
    expect(envois).toEqual([]);
  });
});
