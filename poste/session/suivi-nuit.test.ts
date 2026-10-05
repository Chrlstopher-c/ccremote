import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Evenement, Nuit, ResumeSession } from '../../commun/session.ts';
import { DELAI_REVEIL_MS, REVEILS_SANS_EFFET_MAX, TEXTE_REVEIL } from './nuit.ts';
import { SuiviNuit } from './suivi-nuit.ts';

function banc(statut: ResumeSession['statut'] = 'attente') {
  const dossier = mkdtempSync(join(tmpdir(), 'suivi-'));
  mkdirSync(join(dossier, 'sessions'));
  process.env['QUART_NUIT_DIR'] = dossier;
  const t0 = Date.now();
  writeFileSync(join(dossier, 'sessions', 'abc.json'), JSON.stringify({ since: t0 / 1000, rounds: 0, open: 1 }));
  const etat = {
    id: 's',
    claudeSessionId: 'abc',
    statut,
    tmux: 'claude-x',
    terminal: false,
    nuit: null,
  } as unknown as ResumeSession;
  const evts: Evenement[] = [];
  const collages: string[] = [];
  const publies: (Nuit | null)[] = [];
  const suivi = new SuiviNuit({
    resume: () => etat,
    messagesChrisEnVol: () => 0,
    publierNuit: (n) => void publies.push(n),
    emettre: (e) => void evts.push(e),
    coller: async (t) => {
      collages.push(t);
      return null;
    },
    journal: () => ({ warn: () => undefined }) as never,
  });
  return { suivi, etat, evts, collages, publies, t0, dossier };
}

describe('SuiviNuit', () => {
  test('publie l’état puis réveille une session à l’arrêt après le délai, une seule fois par délai', async () => {
    const b = banc();
    await b.suivi.tick(b.t0);
    expect(b.publies.at(-1)?.casesOuvertes).toBe(1);
    await b.suivi.tick(b.t0 + DELAI_REVEIL_MS + 11_000);
    expect(b.collages).toEqual([TEXTE_REVEIL]);
    await b.suivi.tick(b.t0 + DELAI_REVEIL_MS + 22_000);
    expect(b.collages.length).toBe(1);
  });

  test('abandonne après trop de réveils sans effet, puis se tait', async () => {
    const b = banc();
    let t = b.t0;
    await b.suivi.tick(t);
    for (let i = 0; i < REVEILS_SANS_EFFET_MAX + 3; i++) {
      t += DELAI_REVEIL_MS + 11_000;
      await b.suivi.tick(t);
    }
    expect(b.collages.length).toBe(REVEILS_SANS_EFFET_MAX);
    expect(b.evts.filter((e) => e.type === 'relance' && e.raison.includes('sans effet')).length).toBe(1);
  });

  test('une session au travail n’est jamais réveillée', async () => {
    const b = banc('travail');
    await b.suivi.tick(b.t0);
    await b.suivi.tick(b.t0 + 3 * DELAI_REVEIL_MS);
    expect(b.collages.length).toBe(0);
  });
});
