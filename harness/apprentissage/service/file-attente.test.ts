/**
 * Preuve E6 (2/2) : `enfilerPasseApprentissage` sur un pipeline COMPLET et réussi (transcript
 * réel sur disque, modèle qui répond, rapprochement) — pas seulement les chemins d'erreur
 * couverts par `passe-cloture.test.ts`. Et la preuve d'innocuité au niveau service : modèle
 * indisponible ⇒ la passe se termine quand même, sans exception, avec une entrée rejouable.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fermerBaseApprentissage, ouvrirBaseApprentissage } from '../base/connexion.ts';
import { listerLeconsParProjet, obtenirPasse } from '../base/lecons.ts';
import type { ClientInference } from '../extraction/client-inference.ts';
import type { DonneesMissionTerminee } from '../observation/classement-issue.ts';
import { enfilerPasseApprentissage } from './file-attente.ts';

let dossier: string;
let db: Database;
let configDir: string;
let worktree: string;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'ccremote-file-attente-'));
  db = ouvrirBaseApprentissage({ chemin: join(dossier, 'apprentissage.db') });
  configDir = join(dossier, 'compte-test');
  worktree = join(dossier, 'worktree-mission');
});

afterEach(() => {
  fermerBaseApprentissage(db);
  rmSync(dossier, { recursive: true, force: true });
});

const DONNEES_LIVREE: DonneesMissionTerminee = {
  etatHarness: 'terminee',
  derniereRaisonTerminale: 'result',
  constatGit: { fichiersModifies: 2, dernierCommit: 'abc123 · corrige le défaut' },
  compteurRelances: 0,
  inspection: { verdict: 'progres' },
  budgetConsommeUsd: 0.5,
  budgetMaxUsd: 10,
  contexteTokensUtilises: 500,
};

/** Écrit un transcript minimal exactement où `cheminTranscriptMission` va le chercher. */
function ecrireTranscriptFactice(sessionId: string): void {
  const cleProjet = worktree.replace(/[/\\]/g, '-');
  const dossierProjet = join(configDir, 'projects', cleProjet);
  mkdirSync(dossierProjet, { recursive: true });
  const lignes = [
    JSON.stringify({ type: 'user', sessionId, timestamp: '2026-08-08T10:00:00.000Z', message: { role: 'user', content: 'Corrige le bug.' } }),
    JSON.stringify({
      type: 'assistant',
      sessionId,
      timestamp: '2026-08-08T10:05:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Corrigé et vérifié.' }] },
    }),
  ];
  writeFileSync(join(dossierProjet, `${sessionId}.jsonl`), `${lignes.join('\n')}\n`);
}

describe('enfilerPasseApprentissage (E6) — pipeline complet sur transcript réel', () => {
  test('transcript présent, modèle qui répond ⇒ passe réussie, leçon écrite en base', async () => {
    const sessionId = 'session-succes';
    ecrireTranscriptFactice(sessionId);

    const client: ClientInference = {
      appelerModele: async () =>
        ({
          disponible: true,
          contenu: JSON.stringify([
            {
              enonce: 'Toujours vérifier le transcript avant de conclure une passe.',
              categorie: 'methode',
              portee: 'projet',
              preuve: 'transcript factice de test',
              doublonDe: null,
            },
          ]),
        }) as const,
    };

    const resultat = await enfilerPasseApprentissage(
      { db, client },
      {
        missionId: 'mission-succes',
        sessionId,
        worktree,
        configDir,
        mandat: 'Corriger un défaut.',
        critereArret: 'Tests verts.',
        donneesMission: DONNEES_LIVREE,
      },
    );

    expect(resultat).not.toBeNull();
    expect(resultat?.erreur).toBeNull();
    expect(resultat?.leconsExtraites).toBe(1);

    const passe = obtenirPasse(db, 'mission-succes');
    expect(passe?.issue).toBe('livree');

    // Le projet est résolu en dépôt canonique (worktree n'étant pas un dépôt git ici, le
    // repli documenté par `resolution-projet.ts` s'applique : `worktree` lui-même).
    const lecons = listerLeconsParProjet(db, worktree);
    expect(lecons).toHaveLength(1);
    expect(lecons[0]?.etat).toBe('candidate');
  });

  test('☠ preuve d’innocuité (niveau service) : modèle indisponible ⇒ passe conservée, pas d’exception', async () => {
    const sessionId = 'session-modele-eteint';
    ecrireTranscriptFactice(sessionId);

    const client: ClientInference = { appelerModele: async () => ({ disponible: false, motif: 'ECONNREFUSED (test)' }) };

    const resultat = await enfilerPasseApprentissage(
      { db, client },
      {
        missionId: 'mission-modele-eteint',
        sessionId,
        worktree,
        configDir,
        mandat: 'Corriger un défaut.',
        critereArret: null,
        donneesMission: DONNEES_LIVREE,
      },
    );

    expect(resultat).not.toBeNull();
    expect(resultat?.erreur).toContain('ECONNREFUSED');
    expect(resultat?.leconsExtraites).toBe(0);

    const passe = obtenirPasse(db, 'mission-modele-eteint');
    expect(passe).not.toBeNull();
    expect(passe?.erreur).not.toBeNull(); // rejouable
  });
});
