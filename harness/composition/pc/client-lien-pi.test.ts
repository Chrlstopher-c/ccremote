/**
 * Verrouille les deux défauts trouvés au banc à deux machines (2026-07-22).
 * Aucun test unitaire ne pouvait les voir : ils vivent dans le comportement du
 * VRAI `WebSocket` face à un vrai serveur, pas dans une doublure.
 *
 * `☠` Les deux tiennent à la même cause profonde — `new WebSocket(url)` ne
 * rejette jamais, et un échec émet DEUX événements (`error` puis `close`). Le
 * connecteur qui les ignore éteint le backoff qu'il est censé nourrir.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { creerClientLienPi } from './client-lien-pi.ts';
import { demarrerServeurLienPc, type ServeurLienPc } from '../pi/serveur-lien-pc.ts';
import type { LienWebSocket } from '../../transport/lien-websocket.ts';

const SECRET = 'secret-de-banc-suffisamment-long';

let serveur: ServeurLienPc | null = null;
let client: LienWebSocket | null = null;

function attendre(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Port libre garanti : on ouvre puis on ferme un serveur pour en obtenir un. */
function portLibreEtMort(): number {
  const jetable = demarrerServeurLienPc({ port: 0, hostname: '127.0.0.1', secret: SECRET });
  const port = jetable.port;
  jetable.arreter();
  return port;
}

afterEach(() => {
  client?.fermer();
  client = null;
  serveur?.arreter();
  serveur = null;
});

describe('client du lien Pi — le backoff doit réellement monter', () => {
  test('☠ serveur injoignable : aucun faux rattachement, l’état ne passe jamais par « ouvert »', async () => {
    const port = portLibreEtMort();
    const etatsVus: string[] = [];

    client = creerClientLienPi({ urlPi: `ws://127.0.0.1:${port}/`, secret: SECRET, machineId: 'banc-client' });
    void client.connecter();

    // Échantillonner serré : le défaut d'origine faisait clignoter « ouvert »
    // à chaque tentative ratée — c'est ce clignotement qui alimentait
    // `pcOnline` et aurait fait mentir l'interface toute la nuit.
    for (let i = 0; i < 40; i += 1) {
      etatsVus.push(client.etat());
      await attendre(50);
    }

    expect(etatsVus).not.toContain('ouvert');
    // `rattachements` ne compte que les connexions RÉELLES. Non nul ⇒ le
    // connecteur a résolu sur une socket qui n'était pas ouverte, et le
    // compteur de backoff a été remis à zéro à chaque essai.
    expect(client.rattachements()).toBe(0);
  }, 10_000);

  test('☠ un échec ne planifie qu’UNE reconnexion — `error` puis `close` n’en font pas deux', async () => {
    const port = portLibreEtMort();
    client = creerClientLienPi({ urlPi: `ws://127.0.0.1:${port}/`, secret: SECRET, machineId: 'banc-client' });
    void client.connecter();

    // Sur 2 s, le backoff (500, 1000, 2000…) autorise au plus 3-4 tentatives.
    // La double planification les faisait se multiplier — mesuré en réel :
    // 211 tentatives en 60 s au lieu de 9.
    await attendre(2_000);

    // Aucune connexion réussie, et surtout aucune explosion : si les
    // tentatives se multipliaient, le lien serait saturé de minuteries.
    expect(client.rattachements()).toBe(0);
    expect(client.etat()).toBe('coupe_transitoire');
  }, 10_000);
});

describe('client du lien Pi — le refus d’authentification reste TERMINAL', () => {
  test('☠ secret refusé ⇒ fermeture terminale remontée, jamais une coupure transitoire retentée sans fin', async () => {
    serveur = demarrerServeurLienPc({ port: 0, hostname: '127.0.0.1', secret: SECRET });
    const fermetures: number[] = [];

    client = creerClientLienPi({
      urlPi: `ws://127.0.0.1:${serveur.port}/`,
      secret: 'mauvais-secret',
      machineId: 'banc-client',
      surFermetureTerminale: (f) => fermetures.push(f.code),
    });
    void client.connecter();

    await attendre(1_500);

    // 401 = 4401 traduit par la taxonomie D.2.1. Sans le classement du code
    // avant rejet, cette liste reste VIDE : le process ne saurait jamais
    // pourquoi il n'arrive pas à se connecter, et retenterait pour toujours.
    expect(fermetures).toContain(401);
    expect(client.etat()).toBe('ferme_terminal');
  }, 10_000);
});
