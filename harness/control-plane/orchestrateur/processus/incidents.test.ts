/**
 * Tests du journal d'incidents du processus orchestrateur — doit survivre à
 * plusieurs enregistrements sans jamais écraser les précédents (NDJSON).
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { unlink } from 'node:fs/promises';
import { JournalIncidentsFichier, JournalIncidentsMemoire, type IncidentOrchestrateur } from './incidents.ts';

const CHEMIN_TEST = '/tmp/ccremote-test-incidents-orchestrateur.ndjson';

afterEach(async () => {
  await unlink(CHEMIN_TEST).catch(() => {});
});

function incident(details: Record<string, unknown>): IncidentOrchestrateur {
  return { type: 'fermeture_flux_entree_imprevue', instant: 1, details };
}

describe('JournalIncidentsFichier — append-only', () => {
  test('un incident écrit une ligne JSON lisible', async () => {
    const journal = new JournalIncidentsFichier(CHEMIN_TEST);
    await journal.enregistrer(incident({ cause: 'return' }));
    const contenu = await Bun.file(CHEMIN_TEST).text();
    expect(JSON.parse(contenu.trim())).toMatchObject({ type: 'fermeture_flux_entree_imprevue' });
  });

  test('deux incidents successifs : le second n’écrase JAMAIS le premier', async () => {
    const journal = new JournalIncidentsFichier(CHEMIN_TEST);
    await journal.enregistrer(incident({ cause: 'return' }));
    await journal.enregistrer(incident({ cause: 'throw' }));
    const lignes = (await Bun.file(CHEMIN_TEST).text()).trim().split('\n');
    expect(lignes).toHaveLength(2);
    expect(JSON.parse(lignes[0] as string).details.cause).toBe('return');
    expect(JSON.parse(lignes[1] as string).details.cause).toBe('throw');
  });
});

describe('JournalIncidentsMemoire', () => {
  test('accumule sans perte, pour les tests et une composition custom', () => {
    const journal = new JournalIncidentsMemoire();
    journal.enregistrer(incident({ n: 1 }));
    journal.enregistrer(incident({ n: 2 }));
    expect(journal.incidents).toHaveLength(2);
  });
});
