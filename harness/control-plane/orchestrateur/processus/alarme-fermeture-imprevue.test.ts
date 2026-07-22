/**
 * Tests de l'alarme réelle branchée sur `surFermetureImprevue` (dette H-60,
 * REPRISE.md : « aujourd'hui il n'est branché sur rien »).
 */
import { describe, expect, test } from 'bun:test';
import { construireAlarmeFermetureImprevue, PLAFOND_REDEMARRAGES_AUTOMATIQUES } from './alarme-fermeture-imprevue.ts';
import { JournalIncidentsMemoire } from './incidents.ts';
import { CompteurRelances } from '../../../relance/compteur-relances.ts';

const CONTEXTE = { cause: 'return' as const, messagesEnAttente: 2 };

function journalMuet(): { fatal: () => void; warn: () => void; error: () => void; appels: string[] } {
  const appels: string[] = [];
  return {
    appels,
    fatal: () => appels.push('fatal'),
    warn: () => appels.push('warn'),
    error: () => appels.push('error'),
  };
}

describe('construireAlarmeFermetureImprevue — H-60', () => {
  test('toujours : log fatal ET incident persisté, même sans redémarreur', () => {
    const incidents = new JournalIncidentsMemoire();
    const journal = journalMuet();
    const alarme = construireAlarmeFermetureImprevue({ sessionId: 's1', incidents, journal: journal as never });
    alarme(CONTEXTE);
    expect(journal.appels).toContain('fatal');
    expect(incidents.incidents).toHaveLength(1);
    expect(incidents.incidents[0]).toMatchObject({ type: 'fermeture_flux_entree_imprevue' });
  });

  test('avec redémarreur et sous le plafond : une tentative est planifiée avec un délai croissant', () => {
    const incidents = new JournalIncidentsMemoire();
    const delais: number[] = [];
    const alarme = construireAlarmeFermetureImprevue({
      sessionId: 's1',
      incidents,
      journal: journalMuet() as never,
      redemarrer: (delaiMs) => delais.push(delaiMs),
    });
    alarme(CONTEXTE);
    alarme(CONTEXTE);
    expect(delais).toHaveLength(2);
    expect(delais[1]).toBeGreaterThan(delais[0] as number);
  });

  test('☠ au plafond : plus AUCUNE tentative automatique, mais l’alarme reste journalisée', () => {
    const incidents = new JournalIncidentsMemoire();
    const delais: number[] = [];
    const journal = journalMuet();
    const compteur = new CompteurRelances(PLAFOND_REDEMARRAGES_AUTOMATIQUES);
    const alarme = construireAlarmeFermetureImprevue({
      sessionId: 's1',
      incidents,
      journal: journal as never,
      compteurRelances: compteur,
      redemarrer: (delaiMs) => delais.push(delaiMs),
    });
    for (let i = 0; i < PLAFOND_REDEMARRAGES_AUTOMATIQUES + 2; i += 1) alarme(CONTEXTE);
    expect(delais).toHaveLength(PLAFOND_REDEMARRAGES_AUTOMATIQUES);
    expect(incidents.incidents).toHaveLength(PLAFOND_REDEMARRAGES_AUTOMATIQUES + 2);
    expect(journal.appels.filter((a) => a === 'fatal').length).toBeGreaterThanOrEqual(2);
  });

  test('sans redémarreur injecté : jamais de crash, un warn suffit', () => {
    const incidents = new JournalIncidentsMemoire();
    const journal = journalMuet();
    const alarme = construireAlarmeFermetureImprevue({ sessionId: 's1', incidents, journal: journal as never });
    expect(() => alarme(CONTEXTE)).not.toThrow();
    expect(journal.appels).toContain('warn');
  });
});
