/**
 * Banc d'ASSEMBLAGE du lien Pi↔PC (H-75) : vrai `Bun.serve`, vrai client
 * WebSocket, vraie socket. Aucun double.
 *
 * `☠` Pourquoi ce banc existe : les deux défauts qu'il verrouille étaient
 * invisibles à tout test unitaire, parce qu'ils ne vivent que dans
 * l'enchaînement connexion → coupure → reconnexion. Le scénario d'exploitation
 * de Chris est exactement celui-là — « j'éteins le PC, je vais me coucher, je
 * le rallume le lendemain, tout doit se reconnecter tout seul » — et c'est le
 * seul qui les révèle.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { demarrerServeurLienPc, type ServeurLienPc } from './serveur-lien-pc.ts';
import { entetesAuth } from '../lien-pc-pi/secret.ts';

const SECRET = 'secret-de-banc-suffisamment-long';

let serveur: ServeurLienPc | null = null;

/** Port 0 : le noyau attribue un port libre — jamais de port fixe dans un banc. */
function demarrer(surConnexionAcceptee?: () => void): ServeurLienPc {
  serveur = demarrerServeurLienPc({ port: 0, hostname: '127.0.0.1', secret: SECRET, surConnexionAcceptee });
  return serveur;
}

function ouvrirClient(s: ServeurLienPc, secret: string = SECRET): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${s.port}/`, { headers: entetesAuth(secret) } as never);
}

function evenement(ws: WebSocket, type: 'open' | 'close'): Promise<{ code: number }> {
  return new Promise((resolve) => ws.addEventListener(type, (ev) => resolve(ev as unknown as { code: number })));
}

function attendre(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

afterEach(() => {
  serveur?.arreter();
  serveur = null;
});

describe('serveur du lien Pi↔PC — authentification (H-75, point 2)', () => {
  test('☠ secret invalide ⇒ fermeture 4401 (terminale), jamais une erreur générique retentée en boucle', async () => {
    const s = demarrer();
    const ferme = await evenement(ouvrirClient(s, 'mauvais-secret'), 'close');
    expect(ferme.code).toBe(4401);
  });

  test('☠ secret absent ⇒ refusé aussi — pas d’acceptation par défaut', async () => {
    const s = demarrer();
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/`);
    const ferme = await evenement(ws, 'close');
    expect(ferme.code).toBe(4401);
  });

  test('secret valide ⇒ accepté, rattachement déclenché exactement une fois', async () => {
    let rattachements = 0;
    const s = demarrer(() => {
      rattachements += 1;
    });
    const ws = ouvrirClient(s);
    await evenement(ws, 'open');
    await attendre(50);
    expect(rattachements).toBe(1);
    ws.close();
  });
});

describe('serveur du lien Pi↔PC — cycle extinction / rallumage (H-75)', () => {
  test('☠ une reconnexion après coupure n’est PAS comptée comme un supersede', async () => {
    let rattachements = 0;
    const s = demarrer(() => {
      rattachements += 1;
    });

    const soir = ouvrirClient(s);
    await evenement(soir, 'open');
    const eteint = evenement(soir, 'close');
    soir.close(); // le PC s'éteint
    await eteint;
    await attendre(50);

    const matin = ouvrirClient(s); // le lendemain
    await evenement(matin, 'open');
    await attendre(50);

    expect(rattachements).toBe(2);
    // Le cœur du banc : la connexion de la veille a bien été OUBLIÉE. Sans
    // `oublier()`, ce compteur vaut 1 et l'alarme « deux PC » crie chaque matin
    // — donc ne veut plus rien dire le jour où elle est vraie.
    expect(s.supersedes()).toBe(0);
    matin.close();
  });

  test('deux PC réellement connectés en même temps ⇒ supersede compté, le plus récent gagne', async () => {
    const s = demarrer();
    const premier = ouvrirClient(s);
    await evenement(premier, 'open');
    const evince = evenement(premier, 'close');

    const second = ouvrirClient(s);
    await evenement(second, 'open');
    await evince;

    expect(s.supersedes()).toBe(1);
    second.close();
  });
});
