/**
 * Banc d'ASSEMBLAGE du lien Pi↔machines de travail (H-75) : vrai `Bun.serve`,
 * vrai client WebSocket, vraie socket. Aucun double.
 *
 * `☠` Pourquoi ce banc existe : les défauts qu'il verrouille étaient invisibles
 * à tout test unitaire, parce qu'ils ne vivent que dans l'enchaînement
 * connexion → coupure → reconnexion. Le scénario d'exploitation de Chris est
 * exactement celui-là — « j'éteins le PC, je vais me coucher, je le rallume le
 * lendemain, tout doit se reconnecter tout seul » — et c'est le seul qui les
 * révèle.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { demarrerServeurLienPc, type ServeurLienPc } from './serveur-lien-pc.ts';
import { entetesAuth } from '../lien-pc-pi/secret.ts';
import { ENTETE_MACHINE, entetesMachine } from '../lien-pc-pi/identite-machine.ts';

const SECRET = 'secret-de-banc-suffisamment-long';
const MACHINE = 'banc-pc';

let serveur: ServeurLienPc | null = null;

/** Port 0 : le noyau attribue un port libre — jamais de port fixe dans un banc. */
function demarrer(surConnexionAcceptee?: (machineId: string) => void): ServeurLienPc {
  serveur = demarrerServeurLienPc({ port: 0, hostname: '127.0.0.1', secret: SECRET, surConnexionAcceptee });
  return serveur;
}

function ouvrirClient(s: ServeurLienPc, machineId: string = MACHINE, secret: string = SECRET): WebSocket {
  const entetes = { ...entetesAuth(secret), ...entetesMachine(machineId) };
  return new WebSocket(`ws://127.0.0.1:${s.port}/`, { headers: entetes } as never);
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

describe('serveur du lien — authentification (H-75, point 2)', () => {
  test('☠ secret invalide ⇒ fermeture 4401 (terminale), jamais une erreur générique retentée en boucle', async () => {
    const s = demarrer();
    const ferme = await evenement(ouvrirClient(s, MACHINE, 'mauvais-secret'), 'close');
    expect(ferme.code).toBe(4401);
  });

  test('☠ secret absent ⇒ refusé aussi — pas d’acceptation par défaut', async () => {
    const s = demarrer();
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/`);
    const ferme = await evenement(ws, 'close');
    expect(ferme.code).toBe(4401);
  });

  // ☠ Le rattachement est signalé APRÈS l'ouverture effective du lien, plus
  // dans le handler `open` : la réconciliation partait sinon sur une socket non
  // branchée et ses requêtes étaient abandonnées en silence (constaté en prod).
  // Les attentes ci-dessous couvrent ce délai — les raccourcir rendrait le banc
  // instable sans rien prouver de plus.
  test('secret valide ⇒ accepté, rattachement déclenché exactement une fois, avec l’identité', async () => {
    const vues: string[] = [];
    const s = demarrer((machineId) => vues.push(machineId));
    const ws = ouvrirClient(s);
    await evenement(ws, 'open');
    await attendre(300);
    expect(vues).toEqual([MACHINE]);
    ws.close();
  });
});

describe('serveur du lien — identité de machine (V2, 2026-08-01)', () => {
  test('☠ identité absente ⇒ 4403 terminal, JAMAIS une identité de repli', async () => {
    // Un client d'avant la V2 : secret correct, aucun en-tête d'identité. Le
    // rattacher sous un nom par défaut ferait cohabiter deux machines sous le
    // même nom — c'est-à-dire la tempête d'évictions, mais invisible.
    const s = demarrer();
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/`, { headers: entetesAuth(SECRET) } as never);
    const ferme = await evenement(ws, 'close');
    expect(ferme.code).toBe(4403);
    expect(s.machines()).toEqual([]);
  });

  test('☠ identité malformée ⇒ 4403, jamais normalisée de force', async () => {
    const s = demarrer();
    const entetes = { ...entetesAuth(SECRET), [ENTETE_MACHINE]: '../ailleurs' };
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/`, { headers: entetes } as never);
    const ferme = await evenement(ws, 'close');
    expect(ferme.code).toBe(4403);
  });

  test('une machine connue reste listée hors ligne après sa déconnexion (H-75)', async () => {
    const s = demarrer();
    const ws = ouvrirClient(s, 'vps');
    await evenement(ws, 'open');
    await attendre(300);
    expect(s.machinesEnLigne()).toEqual(['vps']);

    const ferme = evenement(ws, 'close');
    ws.close();
    await ferme;
    await attendre(100);

    // `☠` L'entrée SURVIT : une machine éteinte est un état nominal, pas une
    // disparition. La retirer rendrait irroutable une mission qui vit dessus.
    expect(s.machines().map((m) => m.machineId)).toEqual(['vps']);
    expect(s.machinesEnLigne()).toEqual([]);
  });
});

describe('serveur du lien — cycle extinction / rallumage (H-75)', () => {
  test('☠ une reconnexion après coupure n’est PAS comptée comme un supersede', async () => {
    let rattachements = 0;
    const s = demarrer(() => {
      rattachements += 1;
    });

    const soir = ouvrirClient(s);
    await evenement(soir, 'open');
    await attendre(300);
    const eteint = evenement(soir, 'close');
    soir.close(); // le PC s'éteint
    await eteint;
    await attendre(50);

    const matin = ouvrirClient(s); // le lendemain
    await evenement(matin, 'open');
    // ☠ Après une coupure, le Pi attend un palier de backoff avant de consommer
    // la connexion mise en file : le rattachement n'est donc PAS instantané.
    // Fait mesuré, pas une marge de confort — 300 ms ne suffisent pas.
    await attendre(1_500);

    expect(rattachements).toBe(2);
    // Le cœur du banc : la connexion de la veille a bien été OUBLIÉE. Sans
    // `oublier()`, ce compteur vaut 1 et l'alarme « deux PC » crie chaque matin
    // — donc ne veut plus rien dire le jour où elle est vraie.
    expect(s.supersedes()).toBe(0);
    matin.close();
  });

  test('deux process d’une MÊME machine ⇒ supersede compté, le plus récent gagne', async () => {
    // Comportement VOULU, et conservé de la V1 : c'est la reprise après crash.
    // Le nouveau process doit prendre la place de l'ancien sans attendre
    // l'expiration d'un ping.
    const s = demarrer();
    const premier = ouvrirClient(s, 'meme-machine');
    await evenement(premier, 'open');
    const evince = evenement(premier, 'close');

    const second = ouvrirClient(s, 'meme-machine');
    await evenement(second, 'open');
    await evince;

    expect(s.supersedes()).toBe(1);
    second.close();
  });

  test('☠ deux machines DISTINCTES cohabitent — zéro supersede (dette n°6)', async () => {
    // `☠ RENVERSEMENT DE DOCTRINE ASSUMÉ (2026-08-01)`. Jusqu'à la V2, ce cas
    // était le comportement nominal du serveur : toute seconde connexion
    // évinçait la première, d'où qu'elle vienne. C'est ce qui rendait la
    // cohabitation impossible, et ce qui produisait 1268 évictions en boucle au
    // banc du 22/07 dès que deux superviseurs tournaient — chacun chassant
    // l'autre. Un test qui verrait ici un supersede ne signale PAS une
    // régression : il signale que l'identité n'est plus prise en compte.
    const s = demarrer();
    const pc = ouvrirClient(s, 'trinityarch');
    await evenement(pc, 'open');
    const vps = ouvrirClient(s, 'vps-e411b5c7');
    await evenement(vps, 'open');
    await attendre(300);

    expect(s.supersedes()).toBe(0);
    expect([...s.machinesEnLigne()].sort()).toEqual(['trinityarch', 'vps-e411b5c7']);
    // Deux liens RÉELLEMENT distincts : partager une instance ferait que
    // l'extinction de l'une décrète l'autre morte.
    expect(s.lienPour('trinityarch')).not.toBe(s.lienPour('vps-e411b5c7'));

    pc.close();
    vps.close();
  });
});
