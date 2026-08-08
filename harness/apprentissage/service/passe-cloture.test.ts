/**
 * Preuve E6 (1/2) : une mission enfilée deux fois ne produit qu'UNE ligne
 * `passe_apprentissage` ; une passe qui lève laisse une entrée conservée avec `erreur`,
 * rejouable — jamais une exception qui remonte (PLAN-PORTAGE.md E6).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fermerBaseApprentissage, ouvrirBaseApprentissage } from '../base/connexion.ts';
import { obtenirPasse } from '../base/lecons.ts';
import type { ClientInference } from '../extraction/client-inference.ts';
import type { DonneesMissionTerminee } from '../observation/classement-issue.ts';
import { enfilerPasseApprentissage } from './file-attente.ts';
import { executerPasseCloture, type EntreePasseCloture } from './passe-cloture.ts';

let dossier: string;
let db: Database;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'ccremote-passe-cloture-'));
  db = ouvrirBaseApprentissage({ chemin: join(dossier, 'apprentissage.db') });
});

afterEach(() => {
  fermerBaseApprentissage(db);
  rmSync(dossier, { recursive: true, force: true });
});

const DONNEES_LIVREE: DonneesMissionTerminee = {
  etatHarness: 'terminee',
  derniereRaisonTerminale: 'result',
  constatGit: { fichiersModifies: 3, dernierCommit: 'abc123 · corrige le défaut' },
  compteurRelances: 0,
  inspection: { verdict: 'progres' },
  budgetConsommeUsd: 1.2,
  budgetMaxUsd: 10,
  contexteTokensUtilises: 1000,
};

function clientQuiNeRepondJamais(): ClientInference {
  return { appelerModele: async () => ({ disponible: false, motif: 'modèle non joignable (test)' }) };
}

/**
 * `worktree`/`configDir` pointent vers le dossier jetable du test : `cheminTranscriptMission`
 * y construira un chemin qui n'existe pas, donc `reduireTranscript` échoue — c'est le
 * scénario « passe qui lève » du second test, et un no-op inoffensif pour le premier (le
 * client ne répond jamais, la panne est capturée avant même de lire le transcript... en
 * réalité APRÈS, mais le résultat reste toujours `erreur non nulle`, jamais une exception).
 */
function entree(missionId: string): EntreePasseCloture {
  return {
    missionId,
    sessionId: 'session-x',
    worktree: dossier,
    configDir: dossier,
    mandat: 'Corriger un défaut.',
    critereArret: 'Tests verts.',
    donneesMission: DONNEES_LIVREE,
  };
}

describe('idempotence de la file (E6, artefact réel : la table passe_apprentissage)', () => {
  test('une mission enfilée deux fois ⇒ une seule ligne passe_apprentissage', async () => {
    const client = clientQuiNeRepondJamais();
    const e = entree('mission-double');

    const premiere = await enfilerPasseApprentissage({ db, client }, e);
    expect(premiere).not.toBeNull();
    const apresPremiere = obtenirPasse(db, 'mission-double');
    expect(apresPremiere).not.toBeNull();

    let appeleUneSecondeFois = false;
    const clientQuiCompte: ClientInference = {
      appelerModele: async () => {
        appeleUneSecondeFois = true;
        return { disponible: false, motif: 'ne doit jamais être atteint' };
      },
    };
    const seconde = await enfilerPasseApprentissage({ db, client: clientQuiCompte }, e);
    expect(seconde).toBeNull(); // idempotence : la seconde passe n'est jamais exécutée
    expect(appeleUneSecondeFois).toBe(false); // ☠ protège aussi le quota du compte

    const lignes = db.query('SELECT COUNT(*) AS n FROM passe_apprentissage WHERE mission_id = ?').get('mission-double') as {
      n: number;
    };
    expect(lignes.n).toBe(1);
  });

  test('un transcript introuvable ⇒ passe en échec, entrée conservée avec erreur, rejouable', async () => {
    const client = clientQuiNeRepondJamais();
    // `worktree`/`configDir` pointent vers un dossier vide : `cheminTranscriptMission` construit
    // un chemin qui n'existe pas ⇒ `reduireTranscript` lève ⇒ capturé par `executerPasseCloture`.
    const resultat = await executerPasseCloture(db, client, {
      missionId: 'mission-echec',
      sessionId: 'session-absente',
      worktree: dossier,
      configDir: dossier,
      mandat: 'Corriger un défaut.',
      critereArret: null,
      donneesMission: DONNEES_LIVREE,
    });

    expect(resultat.erreur).not.toBeNull();

    const ligne = obtenirPasse(db, 'mission-echec');
    expect(ligne).not.toBeNull();
    expect(ligne?.erreur).not.toBeNull();
    // La ligne existe et porte l'erreur : une future passe de reprise (hors E6, C-4/E10) peut
    // la retrouver via `WHERE erreur IS NOT NULL` — « rejouable » au sens de la spec.
  });

  test('mission jamais mesurée (constatGit null) ⇒ issue inconnue, aucun appel au modèle', async () => {
    let appele = false;
    const client: ClientInference = {
      appelerModele: async () => {
        appele = true;
        return { disponible: true, contenu: '[]' };
      },
    };
    const resultat = await executerPasseCloture(db, client, {
      missionId: 'mission-inconnue',
      sessionId: 'session-x',
      worktree: dossier,
      configDir: dossier,
      mandat: null,
      critereArret: null,
      donneesMission: { ...DONNEES_LIVREE, constatGit: null },
    });
    expect(resultat.issue).toBe('inconnue');
    expect(resultat.erreur).toBeNull();
    expect(appele).toBe(false); // ☠ SPEC C-2 : une mission jamais mesurée n'alimente aucune leçon
    expect(obtenirPasse(db, 'mission-inconnue')).not.toBeNull();
  });
});
