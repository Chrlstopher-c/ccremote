/**
 * Preuve E5 (C-5) : deux missions distinctes qui produisent la même leçon la promeuvent
 * `active` ; la même mission rejouée deux fois ne produit jamais qu'UNE confirmation
 * (idempotence — SPEC §5.7 `☠`, le piège qui coûte le plus cher de cette étape) ; une
 * contradiction rétrograde immédiatement `active → candidate`.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fermerBaseApprentissage, ouvrirBaseApprentissage } from '../base/connexion.ts';
import { obtenirLecon } from '../base/lecons.ts';
import type { ClientInference } from './client-inference.ts';
import type { LeconExtraite } from './garde-sortie.ts';
import { rapprocherLecons } from './rapprochement.ts';

let dossier: string;
let db: Database;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'ccremote-rapprochement-'));
  db = ouvrirBaseApprentissage({ chemin: join(dossier, 'apprentissage.db') });
});

afterEach(() => {
  fermerBaseApprentissage(db);
  rmSync(dossier, { recursive: true, force: true });
});

/** Client factice : ne doit JAMAIS être appelé pour un match net (fort ou nul). */
function clientQuiNeDoitJamaisEtreAppele(): ClientInference {
  return {
    appelerModele: async () => {
      throw new Error('le modèle ne doit pas être appelé pour un cas non ambigu');
    },
  };
}

const PROJET = '/mnt/projects/exemple';

function lecon(enonce: string, doublonDe: string | null = null): LeconExtraite {
  return { enonce, categorie: 'methode', portee: 'projet', preuve: 'extrait de mission', doublonDe };
}

describe('rapprocherLecons (E5, C-5)', () => {
  test('leçon inédite ⇒ nouvelle candidate à confirmations = 1', async () => {
    const resultats = await rapprocherLecons({
      db,
      client: clientQuiNeDoitJamaisEtreAppele(),
      projet: PROJET,
      missionId: 'mission-1',
      lecons: [lecon('Toujours committer avant de lancer une migration de schéma.')],
    });
    expect(resultats).toHaveLength(1);
    expect(resultats[0]?.action).toBe('nouvelle');
    const creee = obtenirLecon(db, resultats[0]!.leconId);
    expect(creee?.etat).toBe('candidate');
    expect(creee?.confirmations).toBe(1);
  });

  test('deux missions DISTINCTES produisant la même leçon ⇒ promue active', async () => {
    const enonce = 'Toujours committer avant de lancer une migration de schéma.';
    const premiere = await rapprocherLecons({
      db,
      client: clientQuiNeDoitJamaisEtreAppele(),
      projet: PROJET,
      missionId: 'mission-A',
      lecons: [lecon(enonce)],
    });
    const leconId = premiere[0]!.leconId;
    expect(obtenirLecon(db, leconId)?.etat).toBe('candidate');

    const seconde = await rapprocherLecons({
      db,
      client: clientQuiNeDoitJamaisEtreAppele(),
      projet: PROJET,
      missionId: 'mission-B',
      lecons: [lecon(enonce)], // texte quasi identique ⇒ match lexical FORT, pas de modèle
    });
    expect(seconde[0]?.action).toBe('confirmee');
    expect(seconde[0]?.promue).toBe(true);
    const misAJour = obtenirLecon(db, leconId);
    expect(misAJour?.etat).toBe('active');
    expect(misAJour?.confirmations).toBe(2);
  });

  test('idempotence : la MÊME mission rejouée deux fois ⇒ toujours 1 confirmation, jamais 2', async () => {
    const enonce = 'Toujours committer avant de lancer une migration de schéma.';
    const premiere = await rapprocherLecons({
      db,
      client: clientQuiNeDoitJamaisEtreAppele(),
      projet: PROJET,
      missionId: 'mission-A',
      lecons: [lecon(enonce)],
    });
    const leconId = premiere[0]!.leconId;
    expect(obtenirLecon(db, leconId)?.confirmations).toBe(1);

    // Rejeu de la MÊME mission (ex. double appel de la passe de clôture, bug hypothétique
    // du câblage E6) — la protection doit tenir ICI, pas seulement au niveau de la file.
    const rejeu = await rapprocherLecons({
      db,
      client: clientQuiNeDoitJamaisEtreAppele(),
      projet: PROJET,
      missionId: 'mission-A', // même mission
      lecons: [lecon(enonce)],
    });
    expect(rejeu[0]?.action).toBe('confirmee');
    expect(rejeu[0]?.promue).toBe(false); // toujours candidate, pas de fausse promotion
    const apresRejeu = obtenirLecon(db, leconId);
    expect(apresRejeu?.confirmations).toBe(1); // ☠ pas 2 — c'est le test qui n'est pas optionnel
    expect(apresRejeu?.etat).toBe('candidate');
  });

  test('une contradiction rétrograde immédiatement active → candidate', async () => {
    const enonce = 'Playwright valide bien les rendus de cette page.';
    const contraire = 'Playwright ne valide pas bien les rendus de cette page.';

    const premiere = await rapprocherLecons({
      db,
      client: clientQuiNeDoitJamaisEtreAppele(),
      projet: PROJET,
      missionId: 'mission-A',
      lecons: [lecon(enonce)],
    });
    const leconId = premiere[0]!.leconId;
    await rapprocherLecons({
      db,
      client: clientQuiNeDoitJamaisEtreAppele(),
      projet: PROJET,
      missionId: 'mission-B',
      lecons: [lecon(enonce)],
    });
    expect(obtenirLecon(db, leconId)?.etat).toBe('active');

    const troisieme = await rapprocherLecons({
      db,
      client: clientQuiNeDoitJamaisEtreAppele(),
      projet: PROJET,
      missionId: 'mission-C',
      lecons: [lecon(contraire)], // similarité forte, négation divergente ⇒ contredit
    });
    expect(troisieme[0]?.action).toBe('contredite');
    expect(troisieme[0]?.retrogradee).toBe(true);
    expect(obtenirLecon(db, leconId)?.etat).toBe('candidate');
  });

  test('doublonDe valide ⇒ confirme directement la leçon désignée, sans comparaison lexicale', async () => {
    const premiere = await rapprocherLecons({
      db,
      client: clientQuiNeDoitJamaisEtreAppele(),
      projet: PROJET,
      missionId: 'mission-A',
      lecons: [lecon('Toujours vérifier le PRAGMA busy_timeout sur une base SQLite partagée.')],
    });
    const leconId = premiere[0]!.leconId;

    const seconde = await rapprocherLecons({
      db,
      client: clientQuiNeDoitJamaisEtreAppele(),
      projet: PROJET,
      missionId: 'mission-B',
      lecons: [lecon('Formulation totalement différente, mais désignée par doublonDe.', leconId)],
    });
    expect(seconde[0]?.action).toBe('confirmee');
    expect(seconde[0]?.leconId).toBe(leconId);
  });

  test('doublonDe invalide (leçon inexistante) ⇒ retombe sur la comparaison lexicale, jamais un lien mort', async () => {
    const resultats = await rapprocherLecons({
      db,
      client: clientQuiNeDoitJamaisEtreAppele(),
      projet: PROJET,
      missionId: 'mission-A',
      lecons: [lecon('Une leçon tout à fait inédite.', 'lecon-inexistante-xyz')],
    });
    expect(resultats[0]?.action).toBe('nouvelle');
  });

  test('cas ambigu (similarité intermédiaire) ⇒ départagé par le modèle', async () => {
    const enonce = 'Toujours committer avant de lancer une migration de schéma SQLite.';
    const premiere = await rapprocherLecons({
      db,
      client: clientQuiNeDoitJamaisEtreAppele(),
      projet: PROJET,
      missionId: 'mission-A',
      lecons: [lecon(enonce)],
    });
    const leconId = premiere[0]!.leconId;

    let appele = false;
    const clientAmbigu: ClientInference = {
      appelerModele: async () => {
        appele = true;
        return { disponible: true, contenu: JSON.stringify({ relation: 'confirme' }) };
      },
    };
    // Partiellement recouvrant, ni quasi identique ni sans rapport : zone grise volontaire.
    const seconde = await rapprocherLecons({
      db,
      client: clientAmbigu,
      projet: PROJET,
      missionId: 'mission-B',
      lecons: [lecon('Il faut committer un schéma SQLite modifié avant tout redémarrage du service.')],
    });
    expect(appele).toBe(true);
    expect(seconde[0]?.action).toBe('confirmee');
    expect(seconde[0]?.leconId).toBe(leconId);
  });
});
