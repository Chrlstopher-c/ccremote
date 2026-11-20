// Responsabilité : tests de l'arrêt des processus et des sessions tmux, avec signaux et attente simulés.
import { describe, expect, test } from 'bun:test';
import type { Logger } from 'pino';
import type { ProcessusPoste, TmuxPoste } from '../../commun/entretien.ts';
import { arreterProcessus, arreterTmux, type DependancesArret } from './arret.ts';

const JOURNAL = { warn: () => undefined } as unknown as Logger;

function proc(pid: number, debut: string): ProcessusPoste {
  return { pid, debut, ppid: 1, commande: 'x', role: 'autre', session: null, depuis: '', memoire: 0, reste: false };
}

/** Un poste simulé : le processus 500 vit jusqu'au premier signal `arret` ; les signaux sont notés. */
function banc(arret: 'SIGTERM' | 'SIGKILL' | 'jamais' = 'SIGTERM', inventaire: ProcessusPoste[] = [proc(500, '42')]) {
  const signaux: string[] = [];
  let mort = false;
  const d: DependancesArret = {
    inventaire: () => inventaire,
    signaler: (pid, sig) => {
      signaux.push(`${pid}:${sig}`);
      if (sig === arret) mort = true;
    },
    attendre: async () => undefined,
    vivant: () => !mort,
    proteges: new Set([1000, 1001]),
    envoyes: new Set(),
  };
  return { d, signaux };
}

describe('arrêt d’un processus', () => {
  test('SIGTERM, puis « Processus arrêté » si le processus disparaît', async () => {
    const { d, signaux } = banc('SIGTERM');
    expect(await arreterProcessus(d, { pid: 500, debut: '42', force: false })).toEqual({
      ok: true,
      phrase: 'Processus arrêté',
    });
    expect(signaux).toEqual(['500:SIGTERM']);
  });

  test('toujours actif après l’attente : « Toujours actif après 3 s », sans SIGKILL sans force', async () => {
    const { d, signaux } = banc('jamais');
    expect(await arreterProcessus(d, { pid: 500, debut: '42', force: false })).toEqual({
      ok: false,
      phrase: 'Toujours actif après 3 s',
    });
    expect(signaux).toEqual(['500:SIGTERM']);
  });

  test('force sans SIGTERM préalable : seulement un SIGTERM', async () => {
    const { d, signaux } = banc('jamais');
    await arreterProcessus(d, { pid: 500, debut: '42', force: true });
    expect(signaux).toEqual(['500:SIGTERM']);
  });

  test('force après un SIGTERM du même processus (même heure de démarrage) : SIGKILL', async () => {
    const { d, signaux } = banc('SIGKILL');
    await arreterProcessus(d, { pid: 500, debut: '42', force: false });
    d.envoyes.add('500:42');
    const r = await arreterProcessus(d, { pid: 500, debut: '42', force: true });
    expect(signaux).toEqual(['500:SIGTERM', '500:SIGKILL']);
    expect(r.ok).toBe(true);
  });

  test('un PID réutilisé (heure différente) ou absent de l’inventaire : refusé, rien envoyé', async () => {
    const { d, signaux } = banc();
    expect(await arreterProcessus(d, { pid: 500, debut: '99', force: false })).toEqual({
      ok: false,
      phrase: 'Processus inconnu ou déjà terminé',
    });
    expect(await arreterProcessus(d, { pid: 777, debut: '42', force: false })).toEqual({
      ok: false,
      phrase: 'Processus inconnu ou déjà terminé',
    });
    expect(signaux).toEqual([]);
  });

  test('le poste, l’appli et le PID 1 sont protégés, même dans l’inventaire', async () => {
    const { d, signaux } = banc('SIGTERM', [proc(1000, '1'), proc(1, '1')]);
    expect((await arreterProcessus(d, { pid: 1000, debut: '1', force: false })).ok).toBe(false);
    expect((await arreterProcessus(d, { pid: 1, debut: '1', force: false })).ok).toBe(false);
    expect(signaux).toEqual([]);
  });
});

describe('arrêt d’une session tmux', () => {
  const sessions = (noms: string[]): TmuxPoste[] =>
    noms.map((nom) => ({ nom, session: null, depuis: null, reste: false }));

  test('une session de l’inventaire est tuée ; une autre est refusée', async () => {
    const tues: string[] = [];
    const d = {
      sessions: async () => sessions(['claude-a']),
      tuer: async (nom: string) => (tues.push(nom), { code: 0, erreur: '' }),
      journal: JOURNAL,
    };
    expect(await arreterTmux(d, 'claude-a')).toEqual({ ok: true, phrase: 'Session arrêtée' });
    expect(await arreterTmux(d, 'claude-zz')).toEqual({ ok: false, phrase: 'Session inconnue ou déjà terminée' });
    expect(tues).toEqual(['claude-a']);
  });

  test('échec de tmux : « Session non arrêtée »', async () => {
    const d = {
      sessions: async () => sessions(['claude-a']),
      tuer: async () => ({ code: 1, erreur: 'boum' }),
      journal: JOURNAL,
    };
    expect((await arreterTmux(d, 'claude-a')).ok).toBe(false);
  });
});
