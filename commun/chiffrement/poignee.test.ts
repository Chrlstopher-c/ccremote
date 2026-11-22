// Responsabilité : tests de la poignée de main — aller-retour, identité inconnue, signature fausse,
// intermédiaire qui substitue une identité ou se fait passer pour le répondeur, rejeu de réponse, canal détourné.
import { describe, expect, test } from 'bun:test';
import { exporterIdentitePublique, genererIdentite, type Identite } from './identite.ts';
import { initierPoignee, repondrePoignee, terminerPoignee, type MessageInitial } from './poignee.ts';
import type { Canal } from './messages.ts';
import type { Octets } from './octets.ts';

const CANAL = 'tour-portable';

const memeQue =
  (attendu: Identite) =>
  (id: { dh: Octets; signature: Octets }): boolean =>
    exporterIdentitePublique(id) === exporterIdentitePublique(attendu.publique);

const surOctet = (texte: string, position: number): string => {
  const octets = Buffer.from(texte, 'base64url');
  octets[position] = (octets[position] ?? 0) ^ 1;
  return octets.toString('base64url');
};

async function etablir(canal = CANAL): Promise<{ i: Canal; r: Canal; moi: Identite; toi: Identite }> {
  const moi = await genererIdentite();
  const toi = await genererIdentite();
  const { message, attente } = await initierPoignee(moi, toi.publique, canal);
  const { reponse, canal: canalR } = await repondrePoignee(toi, message, memeQue(moi));
  const canalI = await terminerPoignee(attente, reponse);
  return { i: canalI, r: canalR, moi, toi };
}

describe('aller-retour', () => {
  test('chaque côté lit ce que l’autre envoie, dans les deux sens', async () => {
    const { i, r } = await etablir();
    const aller = await i.chiffrer(new TextEncoder().encode('bonjour répondeur'));
    expect(new TextDecoder().decode(await r.dechiffrer(aller))).toBe('bonjour répondeur');
    const retour = await r.chiffrer(new TextEncoder().encode('bonjour initiateur'));
    expect(new TextDecoder().decode(await i.dechiffrer(retour))).toBe('bonjour initiateur');
  });
});

describe('authentification de la poignée', () => {
  test('identité inconnue du répondeur : refusée', async () => {
    const moi = await genererIdentite();
    const toi = await genererIdentite();
    const { message } = await initierPoignee(moi, toi.publique, CANAL);
    await expect(repondrePoignee(toi, message, () => false)).rejects.toThrow();
  });

  test('signature fausse dans le premier message : refusée', async () => {
    const moi = await genererIdentite();
    const toi = await genererIdentite();
    const { message } = await initierPoignee(moi, toi.publique, CANAL);
    const falsifie: MessageInitial = { ...message, signature: surOctet(message.signature, 3) };
    await expect(repondrePoignee(toi, falsifie, () => true)).rejects.toThrow();
  });

  test('canal changé en route (rejeu vers un autre canal) : refusé', async () => {
    const moi = await genererIdentite();
    const toi = await genererIdentite();
    const { message } = await initierPoignee(moi, toi.publique, 'canal-A');
    const detourne: MessageInitial = { ...message, canal: 'canal-B' };
    await expect(repondrePoignee(toi, detourne, () => true)).rejects.toThrow();
  });

  test('réponse signée par une autre clé que celle attendue : refusée', async () => {
    const moi = await genererIdentite();
    const toi = await genererIdentite();
    const intrus = await genererIdentite();
    const { attente } = await initierPoignee(moi, toi.publique, CANAL);
    const eph = await genererIdentite();
    const signature = await crypto.subtle.sign('Ed25519', intrus.signaturePrivee, new Uint8Array(8));
    const faux = {
      ephemere: Buffer.from(eph.publique.dh).toString('base64url'),
      signature: Buffer.from(signature).toString('base64url'),
    };
    await expect(terminerPoignee(attente, faux)).rejects.toThrow();
  });
});

describe('intermédiaire (aiguilleur en homme du milieu)', () => {
  test('usurpation : répondre avec sa propre identité à un message adressé à autrui, refusé', async () => {
    const moi = await genererIdentite();
    const toi = await genererIdentite();
    const mallory = await genererIdentite();
    const { message } = await initierPoignee(moi, toi.publique, CANAL);
    await expect(repondrePoignee(mallory, message, () => true)).rejects.toThrow();
  });

  test('identité de l’initiateur substituée par celle de l’intermédiaire : détectée à la fin', async () => {
    const moi = await genererIdentite();
    const toi = await genererIdentite();
    const mallory = await genererIdentite();
    const { attente } = await initierPoignee(moi, toi.publique, CANAL);
    const { message: forge } = await initierPoignee(mallory, toi.publique, CANAL);
    const { reponse } = await repondrePoignee(toi, forge, () => true);
    await expect(terminerPoignee(attente, reponse)).rejects.toThrow();
  });

  test('réponse d’une autre poignée rejouée : refusée', async () => {
    const moi = await genererIdentite();
    const toi = await genererIdentite();
    const ancienne = await initierPoignee(moi, toi.publique, CANAL);
    const ancienneReponse = await repondrePoignee(toi, ancienne.message, memeQue(moi));
    const nouvelle = await initierPoignee(moi, toi.publique, CANAL);
    await expect(terminerPoignee(nouvelle.attente, ancienneReponse.reponse)).rejects.toThrow();
  });

  test('clé éphémère remplacée en route : signature de l’initiateur fausse', async () => {
    const moi = await genererIdentite();
    const toi = await genererIdentite();
    const { message } = await initierPoignee(moi, toi.publique, CANAL);
    const autre = await initierPoignee(await genererIdentite(), toi.publique, CANAL);
    const falsifie: MessageInitial = { ...message, ephemere: autre.message.ephemere };
    await expect(repondrePoignee(toi, falsifie, () => true)).rejects.toThrow();
  });
});
