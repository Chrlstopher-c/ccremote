import { describe, expect, test } from 'bun:test';
import { connexionRefusee, ECART_TENTATIVES_MS, oublierRefus, renouvelerJeton } from './renouveler-jeton.ts';

const reussi = () => ({ fini: Promise.resolve(0), arreter: () => undefined });

describe('renouvellement du jeton avant le relevé', () => {
  test('lance Claude Code sur le compte, avec son dossier de configuration', async () => {
    const appels: (string | null)[] = [];
    const lanceur = (_exe: string, dossier: string | null) => {
      appels.push(dossier);
      return reussi();
    };
    expect(await renouvelerJeton('/cfg/a', '/bin/claude', lanceur, 1_000)).toBe(true);
    expect(appels).toEqual(['/cfg/a']);
  });

  test('au plus une tentative par demi-heure et par compte (pas de quota brûlé en boucle)', async () => {
    let n = 0;
    const lanceur = () => {
      n += 1;
      return reussi();
    };
    await renouvelerJeton('/cfg/b', '/bin/claude', lanceur, 10_000);
    expect(await renouvelerJeton('/cfg/b', '/bin/claude', lanceur, 10_000 + ECART_TENTATIVES_MS - 1)).toBe(false);
    expect(await renouvelerJeton('/cfg/b', '/bin/claude', lanceur, 10_000 + ECART_TENTATIVES_MS)).toBe(true);
    expect(n).toBe(2);
  });

  test('sans Claude Code installé : rien n’est lancé', async () => {
    expect(await renouvelerJeton('/cfg/c', null, () => reussi(), 1_000)).toBe(false);
  });

  test('échec de Claude Code : faux', async () => {
    const echoue = () => ({ fini: Promise.resolve(1), arreter: () => undefined });
    expect(await renouvelerJeton('/cfg/d', '/bin/claude', echoue, 1_000)).toBe(false);
  });
});

describe('connexion refusée à répétition', () => {
  const echoue = () => ({ fini: Promise.resolve(1), arreter: () => undefined });
  test('deux refus d’affilée : compte tenu pour déconnecté ; un succès l’efface', async () => {
    await renouvelerJeton('/cfg/r', '/bin/claude', echoue, 1_000);
    expect(connexionRefusee('/cfg/r')).toBe(false);
    await renouvelerJeton('/cfg/r', '/bin/claude', echoue, 1_000 + ECART_TENTATIVES_MS);
    expect(connexionRefusee('/cfg/r')).toBe(true);
    await renouvelerJeton('/cfg/r', '/bin/claude', reussi, 1_000 + 2 * ECART_TENTATIVES_MS);
    expect(connexionRefusee('/cfg/r')).toBe(false);
  });

  test('un délai dépassé ou une tentative sautée ne compte pas comme un refus ; un relevé réussi efface', async () => {
    await renouvelerJeton('/cfg/s', '/bin/claude', echoue, 1_000);
    await renouvelerJeton('/cfg/s', '/bin/claude', echoue, 2_000);
    expect(connexionRefusee('/cfg/s')).toBe(false);
    await renouvelerJeton('/cfg/s', '/bin/claude', echoue, 1_000 + ECART_TENTATIVES_MS);
    expect(connexionRefusee('/cfg/s')).toBe(true);
    oublierRefus('/cfg/s');
    expect(connexionRefusee('/cfg/s')).toBe(false);
  });
});

describe('relevé avec un jeton expiré', () => {
  test('le renouvellement est demandé ; sans succès, le relevé dit qu’il manque un jeton, sans appel réseau', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { releverUsage } = await import('./releve.ts');
    const dossier = mkdtempSync(join(tmpdir(), 'releve-'));
    const demandes: (string | null)[] = [];
    const r = await releverUsage(dossier, async (d) => {
      demandes.push(d);
      return false;
    });
    expect(demandes).toEqual([dossier]);
    expect(r.erreur).toBe('aucun jeton OAuth valide');
    rmSync(dossier, { recursive: true });
  });
});
