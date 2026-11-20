// Responsabilité : tests de la liaison occupée — analyse de ss/ps, seul un sshd de l'utilisateur compte, PID validé.
// Un exécuteur SSH simulé : aucune machine réelle n'est jamais contactée.
import { describe, expect, test } from 'bun:test';
import type { Logger } from 'pino';
import { type Lanceur, Ssh, type ResultatSsh } from '../machines/ssh.ts';
import { analyserOccupant, analyserProcessus, occupant, tuerOccupant } from './liaisons.ts';

const JOURNAL = { warn: () => undefined } as unknown as Logger;
const CONNEXION = { hote: 'h.exemple.test', port: 2222, utilisateur: 'relais', cle: '/k' };

/** Un faux ssh : la réponse dépend de la commande distante (dernier argument). */
function faux(reponses: Record<string, string>, commandes: string[] = []): Ssh {
  const lanceur: Lanceur = async (args): Promise<ResultatSsh> => {
    const commande = args.at(-1) ?? '';
    commandes.push(commande);
    const cle = Object.keys(reponses).find((k) => commande.startsWith(k));
    return {
      code: cle === undefined ? 1 : 0,
      sortie: cle === undefined ? '' : (reponses[cle] ?? ''),
      erreurs: '',
      delaiDepasse: false,
    };
  };
  return new Ssh(lanceur);
}

describe('analyse des sorties distantes', () => {
  test('PID du listener ss ; utilisateur, programme et date ps', () => {
    expect(analyserOccupant('LISTEN 0 128 127.0.0.1:47321 users:(("sshd",pid=4242,fd=7))')).toBe(4242);
    expect(analyserOccupant('rien')).toBeNull();
    expect(analyserProcessus('relais sshd Thu Nov 20 06:31:00 2026\n')).toEqual({
      user: 'relais',
      comm: 'sshd',
      lstart: 'Thu Nov 20 06:31:00 2026',
    });
  });
});

describe('occupant de la liaison', () => {
  test('un sshd de l’utilisateur de la fiche : occupé, avec sa date de démarrage', async () => {
    const ssh = faux({
      'ss ': 'LISTEN users:(("sshd",pid=4242,fd=7))',
      'ps ': 'relais sshd Thu Nov 20 06:31:00 2026',
    });
    const r = await occupant({ ssh, journal: JOURNAL }, CONNEXION, 47321);
    expect(r).toMatchObject({ occupe: true, pid: 4242 });
    expect(r.depuis).not.toBeNull();
  });

  test('un autre utilisateur, un autre programme, ou rien d’écoutant : pas occupé', async () => {
    const autre = faux({ 'ss ': 'users:(("sshd",pid=4242))', 'ps ': 'root sshd Thu Nov 20 06:31:00 2026' });
    expect(await occupant({ ssh: autre, journal: JOURNAL }, CONNEXION, 47321)).toEqual({
      occupe: false,
      pid: null,
      depuis: null,
    });
    const nginx = faux({ 'ss ': 'users:(("nginx",pid=4242))', 'ps ': 'relais nginx Thu Nov 20 06:31:00 2026' });
    expect((await occupant({ ssh: nginx, journal: JOURNAL }, CONNEXION, 47321)).occupe).toBe(false);
    const vide = faux({ 'ss ': '' });
    expect((await occupant({ ssh: vide, journal: JOURNAL }, CONNEXION, 47321)).occupe).toBe(false);
  });

  test('port hors plage : rien n’est demandé à la machine', async () => {
    const commandes: string[] = [];
    expect((await occupant({ ssh: faux({}, commandes), journal: JOURNAL }, CONNEXION, 0)).occupe).toBe(false);
    expect(commandes).toEqual([]);
  });
});

describe('libération de la liaison', () => {
  test('signal d’arrêt au PID entier vérifié, et rien d’autre', async () => {
    const commandes: string[] = [];
    const r = await tuerOccupant({ ssh: faux({ 'kill ': '' }, commandes), journal: JOURNAL }, CONNEXION, 4242);
    expect(r).toEqual({ ok: true, phrase: 'Processus arrêté' });
    expect(commandes).toEqual(['kill 4242']);
  });

  test('un PID non entier ou hors plage : refusé, aucune commande', async () => {
    const commandes: string[] = [];
    const ssh = faux({ 'kill ': '' }, commandes);
    expect((await tuerOccupant({ ssh, journal: JOURNAL }, CONNEXION, 1)).ok).toBe(false);
    expect((await tuerOccupant({ ssh, journal: JOURNAL }, CONNEXION, 1.5)).ok).toBe(false);
    expect(commandes).toEqual([]);
  });
});
