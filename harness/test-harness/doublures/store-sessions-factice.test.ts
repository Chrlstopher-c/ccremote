// Injecteurs des pannes #4 (`listSubkeys` absente — historique des sous-agents
// perdu sans erreur) et #8 (`delete` absente — suppression acceptée sans effet),
// plus la politique d'échec E.3.3 : rejet réessayé 3×, timeout 60 s non réessayé.

import { describe, expect, test } from 'bun:test';
import { HorlogeSimulee } from '../deterministe/horloge-simulee.ts';
import { avancerAsync } from '../deterministe/pompe.ts';
import { JournalPannes } from '../journal/journal-pannes.ts';
import { REESSAIS_SUR_REJET, TIMEOUT_STORE_MS } from '../contrats/session-store.ts';
import type { EntreeSession } from '../contrats/session-store.ts';
import { OPTIONS_STORE_SAINES, StoreSessionsFactice } from './store-sessions-factice.ts';
import type { OptionsStore } from './store-sessions-factice.ts';
import { rejouerDeuxFois } from '../rejeu.ts';

interface Montage {
  readonly horloge: HorlogeSimulee;
  readonly journal: JournalPannes;
  readonly store: StoreSessionsFactice;
}

const monter = (options: Partial<OptionsStore> = {}): Montage => {
  const horloge = new HorlogeSimulee();
  const journal = new JournalPannes(horloge);
  const store = new StoreSessionsFactice(horloge, journal, { ...OPTIONS_STORE_SAINES, ...options });
  return { horloge, journal, store };
};

/** Déroule un `append` en avançant le temps simulé : jamais d'attente réelle. */
const appendPompe = async (
  m: Montage,
  cle: string,
  entrees: readonly EntreeSession[],
): Promise<void> => {
  const promesse = m.store.append(cle, entrees);
  await avancerAsync(m.horloge, TIMEOUT_STORE_MS * 2);
  await promesse;
};

describe('StoreSessionsFactice — régime sain', () => {
  test('append écrit et load relit', async () => {
    const m = monter();
    await appendPompe(m, 'k', [{ uuid: 'a', texte: 'un' }]);
    expect(await m.store.load('k')).toEqual([{ uuid: 'a', texte: 'un' }]);
    expect(m.store.lotsAbandonnes()).toBe(0);
  });

  test('load d’une clé inconnue rend null', async () => {
    const m = monter();
    expect(await m.store.load('absente')).toBeNull();
  });

  test('idempotence E.3.2 : même uuid ⇒ upsert, pas de doublon', async () => {
    const m = monter();
    await appendPompe(m, 'k', [{ uuid: 'a', v: 1 }]);
    await appendPompe(m, 'k', [{ uuid: 'a', v: 2 }]);
    expect(m.store.entrees('k')).toEqual([{ uuid: 'a', v: 2 }]);
  });

  test('sans uuid, les entrées s’ajoutent sans déduplication', async () => {
    const m = monter();
    await appendPompe(m, 'k', [{ v: 1 }]);
    await appendPompe(m, 'k', [{ v: 1 }]);
    expect(m.store.entrees('k')).toHaveLength(2);
  });
});

describe('StoreSessionsFactice — politique d’échec E.3.3', () => {
  test('un rejet transitoire est réessayé et finit par passer', async () => {
    const m = monter();
    m.store.injecterRejets(2);
    await appendPompe(m, 'k', [{ uuid: 'a' }]);
    expect(m.store.tentativesAppend()).toBe(3);
    expect(m.store.lotsAbandonnes()).toBe(0);
    expect(m.journal.compter('append_rejete')).toBe(2);
    expect(m.store.entrees('k')).toHaveLength(1);
  });

  test('rejets épuisés : lot abandonné, mirror_error, sous-processus intact', async () => {
    const m = monter();
    m.store.injecterRejets(REESSAIS_SUR_REJET + 1);
    await appendPompe(m, 'k', [{ uuid: 'a' }, { uuid: 'b' }]);
    expect(m.store.tentativesAppend()).toBe(REESSAIS_SUR_REJET + 1);
    expect(m.store.lotsAbandonnes()).toBe(1);
    expect(m.store.entrees('k')).toHaveLength(0);
    expect(m.store.messagesMiroirErreur()).toEqual([
      { type: 'mirror_error', cle: 'k', cause: 'rejet_epuise', entreesAbandonnees: 2, a: 2_000 },
    ]);
    expect(m.store.sousProcessusActif()).toBe(true);
  });

  test('un timeout n’est PAS réessayé et coûte exactement 60 s', async () => {
    const m = monter();
    m.store.injecterTimeout();
    await appendPompe(m, 'k', [{ uuid: 'a' }]);
    expect(m.store.tentativesAppend()).toBe(1);
    expect(m.store.lotsAbandonnes()).toBe(1);
    expect(m.store.messagesMiroirErreur()[0]?.cause).toBe('timeout');
    expect(m.store.messagesMiroirErreur()[0]?.a).toBe(TIMEOUT_STORE_MS);
    expect(m.journal.contient('append_timeout')).toBe(true);
  });

  test('après un lot abandonné, l’append suivant réussit', async () => {
    const m = monter();
    m.store.injecterTimeout();
    await appendPompe(m, 'k', [{ uuid: 'a' }]);
    await appendPompe(m, 'k', [{ uuid: 'b' }]);
    expect(m.store.entrees('k')).toEqual([{ uuid: 'b' }]);
  });
});

describe('StoreSessionsFactice — panne #4 (listSubkeys absente)', () => {
  test('implémentée : la reprise matérialise les transcripts de sous-agents', async () => {
    const m = monter({ listSubkeysImplementee: true });
    m.store.declarerSousCles('k', ['k/sous-1', 'k/sous-2']);
    expect(await m.store.materialiserReprise('k')).toEqual(['k/sous-1', 'k/sous-2']);
    expect(m.journal.contient('subkeys_absentes')).toBe(false);
  });

  test('absente : perte totale de l’historique des sous-agents, sans erreur', async () => {
    const m = monter({ listSubkeysImplementee: false });
    m.store.declarerSousCles('k', ['k/sous-1']);
    expect(m.store.listSubkeys).toBeUndefined();
    expect(await m.store.materialiserReprise('k')).toEqual([]);
    expect(m.journal.contient('subkeys_absentes')).toBe(true);
  });
});

describe('StoreSessionsFactice — panne #8 (delete absente)', () => {
  test('implémentée : la suppression efface réellement', async () => {
    const m = monter({ deleteImplementee: true });
    await appendPompe(m, 'k', [{ uuid: 'a' }]);
    await m.store.supprimerViaContrat('k');
    expect(await m.store.load('k')).toBeNull();
    expect(m.journal.contient('suppression_no_op')).toBe(false);
  });

  test('absente : suppression acceptée sans rien supprimer et sans erreur', async () => {
    const m = monter({ deleteImplementee: false });
    await appendPompe(m, 'k', [{ uuid: 'a' }]);
    expect(m.store.delete).toBeUndefined();
    await m.store.supprimerViaContrat('k');
    expect(m.store.entrees('k')).toHaveLength(1);
    expect(m.journal.contient('suppression_no_op')).toBe(true);
  });
});

describe('StoreSessionsFactice — reproductibilité', () => {
  test('rejets puis timeout produisent deux fois la même trace', async () => {
    const { premiere, seconde } = await rejouerDeuxFois(async () => {
      const m = monter();
      m.store.injecterRejets(2);
      await appendPompe(m, 'k', [{ uuid: 'a' }]);
      m.store.injecterTimeout();
      await appendPompe(m, 'k', [{ uuid: 'b' }]);
      return m.journal.faits();
    });
    expect(premiere).toBe(seconde);
    expect(premiere).toContain('mirror_error');
  });
});
