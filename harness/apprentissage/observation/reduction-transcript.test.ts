/**
 * Preuve E2 (1/2) : `reduireTranscript` tolère les types de ligne inconnus et les lignes
 * tronquées, et produit un `ResumeMission` correct. Fixtures extraites de vrais transcripts
 * du disque (PLAN-PORTAGE.md, E2, `☠` : un exemple réel bat dix specs), pas construites de
 * tête — voir `fixtures/*.jsonl` et le commentaire en tête de chacune.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { estimerTokensResumeMission, reduireTranscript } from './reduction-transcript.ts';

const DOSSIER_FIXTURES = join(import.meta.dir, 'fixtures');

describe('reduireTranscript (E2)', () => {
  test('tolère un type de ligne inconnu et une ligne tronquée en fin de fichier', async () => {
    // Fixture = transcript réel entier (5a556f7f…, 2026-07-22) + une ligne tronquée ajoutée en
    // fin de fichier pour simuler un CLI qui écrit encore. Types réels présents :
    // queue-operation, attachment, ai-title, last-prompt (tous « inconnus » du réducteur).
    const resume = await reduireTranscript({
      missionId: 'mission-fixture-1',
      projet: '/mnt/projects/ccremote/harness',
      mandat: 'Réponds : ok',
      critereArret: null,
      issue: 'livree',
      cheminTranscript: join(DOSSIER_FIXTURES, 'transcript-reel-extrait.jsonl'),
    });

    expect(resume.sessionId).toBe('5a556f7f-b628-4dac-9567-673d117c1740');
    expect(resume.nbTours).toBe(1);
    expect(resume.extraitFinal).toBe('ok');
    expect(resume.erreurs).toHaveLength(0);
    expect(resume.fichiersTouches).toHaveLength(0);
    expect(resume.dureeMs).toBeGreaterThan(0);
  });

  test('agrège outils, échecs, fichiers touchés et commandes échouées', async () => {
    // Fixture = quatre lignes réelles extraites de fa3fbdf6… (2026-08-06) : un Edit réussi,
    // un Bash en échec (« Exit code 123 »), plus une ligne `attachment` inconnue et une ligne
    // tronquée.
    const resume = await reduireTranscript({
      missionId: 'mission-fixture-2',
      projet: '/mnt/projects/ccremote',
      mandat: null,
      critereArret: null,
      issue: 'echec_technique',
      cheminTranscript: join(DOSSIER_FIXTURES, 'transcript-reel-erreurs.jsonl'),
    });

    expect(resume.nbTours).toBe(2);

    const edit = resume.outils.find((o) => o.nom === 'Edit');
    expect(edit).toEqual({ nom: 'Edit', appels: 1, echecs: 0 });
    const bash = resume.outils.find((o) => o.nom === 'Bash');
    expect(bash).toEqual({ nom: 'Bash', appels: 1, echecs: 1 });

    expect(resume.fichiersTouches).toEqual(['harness/superviseur/superviseur-workers.ts']);
    expect(resume.erreurs).toHaveLength(1);
    expect(resume.erreurs[0]).toContain('Exit code 123');
    expect(resume.commandesEchouees).toHaveLength(1);
    expect(resume.commandesEchouees[0]).toContain('find harness/superviseur');
    expect(resume.commandesEchouees[0]).toContain('code 123');
  });

  test('les bornes sont respectées et l’estimation de tokens reste sous 2 000', async () => {
    const resume = await reduireTranscript({
      missionId: 'mission-fixture-3',
      projet: '/mnt/projects/ccremote',
      mandat: 'x'.repeat(1000),
      critereArret: null,
      issue: 'livree',
      cheminTranscript: join(DOSSIER_FIXTURES, 'transcript-reel-erreurs.jsonl'),
    });

    expect(resume.mandatResume.length).toBeLessThanOrEqual(401); // 400 + `…`
    expect(resume.erreurs.length).toBeLessThanOrEqual(10);
    expect(resume.fichiersTouches.length).toBeLessThanOrEqual(30);
    expect(resume.commandesEchouees.length).toBeLessThanOrEqual(10);
    expect(resume.extraitFinal.length).toBeLessThanOrEqual(1_501);
    expect(estimerTokensResumeMission(resume)).toBeLessThan(2_000);
  });
});
