import { describe, expect, test } from 'bun:test';
import type { forkSession } from '@anthropic-ai/claude-agent-sdk';
import { CONSIGNE_ANNEXE, TITRE_ANNEXE } from './annexe.ts';
import { annexer, dupliquer, type DependancesCopie } from './copie.ts';
import { journal, nouvelleSession } from './faux-sdk.ts';
import type { TranscriptDecouvert } from './decouverte.ts';
import { ControlesDifferes, estAuRepos } from './controle-differe.ts';

const COPIE: TranscriptDecouvert = {
  id: 'copie-1',
  cwd: '/projets/app',
  chemin: '/tmp/fictif.jsonl',
  configDir: null,
  titre: 'Copie',
  modifieLe: '2026-11-19T10:00:00.000Z',
  machine: 'tour',
  branche: null,
  messages: 1,
};

type Importe = { t: TranscriptDecouvert; surcharge: Record<string, unknown>; consignes: string | null };

function deps(options: { fork?: 'ok' | 'echec'; trouve?: boolean; parente?: 'annexe' } = {}) {
  const parente = nouvelleSession(
    async () => [{ type: 'result' }],
    options.parente ? { resume: { annexe_de: 'autre' } } : {},
  );
  const forks: { id: string; options: unknown }[] = [];
  const importes: Importe[] = [];
  let sauvegardes = 0;
  const fork = (async (id: string, opts: unknown) => {
    forks.push({ id, options: opts });
    if (options.fork === 'echec') throw new Error('SDK indisponible');
    return { sessionId: 'copie-1' };
  }) as unknown as typeof forkSession;
  const d: DependancesCopie = {
    sessions: new Map([['parente', parente.session]]),
    journal,
    trouverImportables: () => (options.trouve === false ? [] : [COPIE]),
    importerUne: (t, surcharge, consignes) =>
      importes.push({ t, surcharge: surcharge as Record<string, unknown>, consignes }),
    sauvegarder: () => {
      sauvegardes += 1;
    },
    fork,
  };
  return { d, forks, importes, sauvegardes: () => sauvegardes };
}

describe('conversation annexe', () => {
  test('copie complète, nommée, marquée comme annexe de la parente, sans permission', async () => {
    const t = deps();
    const r = await annexer(t.d, 'parente');
    expect(r).toEqual({ ok: true, donnees: { id: 'copie-1' } });
    expect(t.forks[0]).toEqual({ id: 'claude-abc', options: { dir: '/projets/app', title: TITRE_ANNEXE } });
    expect(t.importes[0]?.surcharge).toEqual({
      titre: TITRE_ANNEXE,
      moteur: 'sdk',
      pilotee: true,
      mode: 'bypassPermissions',
      annexe_de: 'parente',
    });
    expect(t.importes[0]?.consignes).toBe(CONSIGNE_ANNEXE);
    expect(t.sauvegardes()).toBe(1);
  });

  test('une annexe n’a pas d’annexe : refus avant toute copie', async () => {
    const t = deps({ parente: 'annexe' });
    expect((await annexer(t.d, 'parente')).ok).toBe(false);
    expect(t.forks.length).toBe(0);
  });

  test('SDK en échec : erreur lisible, rien n’est importé', async () => {
    const t = deps({ fork: 'echec' });
    const r = await annexer(t.d, 'parente');
    expect(r).toEqual({ ok: false, erreur: 'annexe impossible : Error: SDK indisponible' });
    expect(t.importes.length).toBe(0);
  });

  test('copie absente du transcript : erreur, sans import', async () => {
    const t = deps({ trouve: false });
    expect(await annexer(t.d, 'parente')).toEqual({ ok: false, erreur: 'copie annexe introuvable sur le poste' });
  });
});

describe('duplication', () => {
  test('le fil s’arrête au message demandé, la copie est importée sans réglage d’annexe', async () => {
    const t = deps();
    const r = await dupliquer(t.d, 'parente', 'msg-1');
    expect(r).toEqual({ ok: true, donnees: { sessionId: 'copie-1' } });
    expect(t.forks[0]?.options).toEqual({ dir: '/projets/app', upToMessageId: 'msg-1' });
    expect(t.importes[0]).toEqual({ t: COPIE, surcharge: {}, consignes: null });
  });
});

describe('Remote Control différé', () => {
  test('branché seulement au repos : pas pendant un tour ni devant un dialogue', async () => {
    const travail = nouvelleSession(async () => [{ type: 'result' }]).session;
    expect(estAuRepos(travail)).toBe(true);
    await travail.lancer('x');
    expect(estAuRepos(travail)).toBe(false);
  });

  test('session disparue : retirée de l’attente sans appel de bascule', async () => {
    const controles = new ControlesDifferes();
    controles.ajouter('absente');
    let journaux = 0;
    const g = {
      sessions: new Map(),
      config: { machine: 'tour' },
      journal: { warn: () => (journaux += 1) },
      creer: () => {
        throw new Error('non attendu');
      },
      sauvegarder: () => undefined,
    };
    await controles.traiter(g as never);
    expect(journaux).toBe(0);
  });
});
