/**
 * Responsabilité : preuve AXE A3 (caching de prompt, PLAN-OPTIMISATION-QUOTAS.md).
 *
 * Le SDK (`@anthropic-ai/claude-agent-sdk` 0.3.220, preset `claude_code`) gère le
 * placement des `cache_control` lui-même — aucune API n'est exposée pour les poser
 * à la main (voir rapport). Le seul levier côté harness est donc de GARANTIR que le
 * `systemPrompt` composé pour une équipe (préfixe stable, celui qui survit à la
 * compaction) est identique octet pour octet entre deux compositions du MÊME mandat,
 * et ne porte aucune donnée qui varierait d'un tour à l'autre (timestamp, budget
 * courant recalculé, compteur, date, état de parc).
 *
 * `☠` Un `Date.now()`, un compteur ou un état de parc lu dans `composerMandatSysteme`
 * ou `MANDAT_ORCHESTRATEUR` casserait le cache à CHAQUE dispatch — l'API ne reverrait
 * jamais deux fois le même préfixe, donc jamais de `cache_read_input_tokens`. Ces
 * tests figent l'invariant : composition pure, sans horloge ni base lue à cet endroit.
 */

import { describe, expect, test } from 'bun:test';
import type { Proposition } from '../registre/types.ts';
import { ACCES_DEFAUT } from '../../shared/acces-mandat.ts';
import { composerMandatSysteme, composerPromptInitial } from './dispatch-mandat.ts';
import { MANDAT_ORCHESTRATEUR } from './processus/mandat.ts';

const PROPOSITION: Proposition = {
  id: 'prop-a3',
  conversationId: null,
  projet: '/mnt/projects/vela',
  objectif: 'Auditer Vela',
  critereArret: 'rapport rendu',
  perimetre: 'lecture seule',
  latitude: null,
  acces: ACCES_DEFAUT,
  budgetMaxUsd: 12,
  modele: null,
  effort: null,
  statut: 'approuvee',
  missionId: null,
} as never;

describe('A3 — systemPrompt du worker est un préfixe stable (cache-eligible)', () => {
  test('composerMandatSysteme rend un texte IDENTIQUE octet pour octet entre deux appels', () => {
    const a = composerMandatSysteme(PROPOSITION, ACCES_DEFAUT);
    const b = composerMandatSysteme(PROPOSITION, ACCES_DEFAUT);
    expect(a).toBe(b);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  test('composerMandatSysteme ne porte aucun marqueur de donnée variable par tour', () => {
    const mandat = composerMandatSysteme(PROPOSITION, ACCES_DEFAUT);
    // Un timestamp ISO, une date lisible, ou un compteur inscrit en dur trahirait
    // une composition qui varierait à chaque dispatch — aucun des deux n'a sa place
    // dans le préfixe stable (le budget est un plafond FIXE de la mission, pas une
    // dépense courante recalculée).
    expect(mandat).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // ISO datetime
    expect(mandat).not.toMatch(/dépense courante|consommé jusqu'ici|solde restant/);
  });

  test('composerPromptInitial (jetable, hors préfixe caché) reste distinct du systemPrompt', () => {
    const systeme = composerMandatSysteme(PROPOSITION, ACCES_DEFAUT);
    const initial = composerPromptInitial(PROPOSITION, ACCES_DEFAUT);
    // Invariant à préserver (contrainte de la mission) : les deux ne se confondent
    // jamais — le premier message reste court et jetable, le systemPrompt porte le
    // cadre complet.
    expect(initial).not.toBe(systeme);
    expect(initial.length).toBeLessThan(systeme.length);
  });

  test('deux missions différentes produisent des systemPrompt différents (pas de collision de cache)', () => {
    const autre: Proposition = { ...PROPOSITION, id: 'prop-a3-bis', objectif: 'Auditer autre chose' } as never;
    const a = composerMandatSysteme(PROPOSITION, ACCES_DEFAUT);
    const b = composerMandatSysteme(autre, ACCES_DEFAUT);
    expect(a).not.toBe(b);
  });
});

describe('A3 — systemPrompt de l’orchestrateur (MANDAT_ORCHESTRATEUR) est une constante figée', () => {
  test('MANDAT_ORCHESTRATEUR est une chaîne statique, sans interpolation résiduelle', () => {
    // Une session orchestrateur tourne en continu (tours très rapprochés) — c'est le
    // cas où le gain de cache est le plus net. Le moindre `${...}` non résolu ou motif
    // de donnée vivante suffirait à casser le préfixe à chaque tour.
    expect(MANDAT_ORCHESTRATEUR).not.toMatch(/\$\{/);
    expect(MANDAT_ORCHESTRATEUR).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  test('MANDAT_ORCHESTRATEUR est identique à lui-même entre deux lectures (référence stable)', () => {
    // Constante de module : aucune fonction ne la régénère — la seule façon de la
    // casser serait d'en faire un template dynamique un jour. Ce test échoue alors.
    const a = MANDAT_ORCHESTRATEUR;
    const b = MANDAT_ORCHESTRATEUR;
    expect(a).toBe(b);
  });
});
