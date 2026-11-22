// Responsabilité : tests du canal chiffré — AES-GCM, compteurs par sens, refus du rejeu, du réordonnancement,
// de la troncature, de l'altération, de la réflexion et du mélange de canaux.
import { describe, expect, test } from 'bun:test';
import { exporterIdentitePublique, genererIdentite, type Identite } from './identite.ts';
import { initierPoignee, repondrePoignee, terminerPoignee } from './poignee.ts';
import type { Canal } from './messages.ts';

const octets = (texte: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(texte);
const lisible = (o: Uint8Array): string => new TextDecoder().decode(o);

async function paire(canal: string, moi?: Identite, toi?: Identite): Promise<{ i: Canal; r: Canal }> {
  const a = moi ?? (await genererIdentite());
  const b = toi ?? (await genererIdentite());
  const { message, attente } = await initierPoignee(a, b.publique, canal);
  const cle = exporterIdentitePublique(a.publique);
  const { reponse, canal: r } = await repondrePoignee(b, message, (id) => exporterIdentitePublique(id) === cle);
  return { i: await terminerPoignee(attente, reponse), r };
}

const premierOctetFaux = (o: Uint8Array, position: number): Uint8Array<ArrayBuffer> => {
  const copie = new Uint8Array(o);
  copie[position] = (copie[position] ?? 0) ^ 0x80;
  return copie;
};

describe('réception nominale', () => {
  test('trames successives lues dans l’ordre, même texte chiffré deux fois différent', async () => {
    const { i, r } = await paire('c1');
    const t1 = await i.chiffrer(octets('un'));
    const t2 = await i.chiffrer(octets('un'));
    expect(Buffer.from(t1).equals(Buffer.from(t2))).toBe(false);
    expect(lisible(await r.dechiffrer(t1))).toBe('un');
    expect(lisible(await r.dechiffrer(t2))).toBe('un');
  });
});

describe('refus', () => {
  test('rejeu d’une trame déjà lue : refusé', async () => {
    const { i, r } = await paire('c1');
    const trame = await i.chiffrer(octets('x'));
    await r.dechiffrer(trame);
    await expect(r.dechiffrer(trame)).rejects.toThrow();
  });

  test('réordonnancement : la trame 2 avant la trame 1 est refusée, puis la suite reprend', async () => {
    const { i, r } = await paire('c1');
    const t1 = await i.chiffrer(octets('1'));
    const t2 = await i.chiffrer(octets('2'));
    await expect(r.dechiffrer(t2)).rejects.toThrow();
    expect(lisible(await r.dechiffrer(t1))).toBe('1');
    expect(lisible(await r.dechiffrer(t2))).toBe('2');
  });

  test('trame tronquée (un octet ou fortement) : refusée', async () => {
    const { i, r } = await paire('c1');
    const trame = await i.chiffrer(octets('texte assez long'));
    await expect(r.dechiffrer(trame.subarray(0, trame.length - 1))).rejects.toThrow();
    await expect(r.dechiffrer(trame.subarray(0, 10))).rejects.toThrow();
    await expect(r.dechiffrer(new Uint8Array(0))).rejects.toThrow();
  });

  test('altération d’un octet du chiffré ou du compteur : refusée', async () => {
    const { i, r } = await paire('c1');
    const trame = await i.chiffrer(octets('intact'));
    await expect(r.dechiffrer(premierOctetFaux(trame, trame.length - 1))).rejects.toThrow();
    await expect(r.dechiffrer(premierOctetFaux(trame, 7))).rejects.toThrow();
  });

  test('réflexion : une trame de l’initiateur renvoyée à l’initiateur : refusée', async () => {
    const { i } = await paire('c1');
    const trame = await i.chiffrer(octets('miroir'));
    await expect(i.dechiffrer(trame)).rejects.toThrow();
  });
});

describe('séparation des canaux', () => {
  test('deux canaux entre les mêmes identités ne partagent aucune clé', async () => {
    const moi = await genererIdentite();
    const toi = await genererIdentite();
    const a = await paire('canal-A', moi, toi);
    const b = await paire('canal-B', moi, toi);
    const trameA = await a.i.chiffrer(octets('secret'));
    await expect(b.r.dechiffrer(trameA)).rejects.toThrow();
    const trameB = await b.i.chiffrer(octets('secret'));
    expect(Buffer.from(trameB).equals(Buffer.from(trameA))).toBe(false);
  });
});
