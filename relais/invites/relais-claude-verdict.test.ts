// Responsabilité : tests unitaires du verdict d'une requête Claude relayée (membre, machine, chemin, part, modèle,
// effort, sessions simultanées) — pur, sans réseau.
import { describe, expect, test } from 'bun:test';
import { reglagesParDefaut, type ReglagesInvite } from '../../commun/invites.ts';
import { verdictRequeteClaude, type EntreeVerdictClaude } from './relais-claude-verdict.ts';

const MOI = 'cccccccccccc';
const CORPS_OK = JSON.stringify({ model: 'claude-haiku-5-5', messages: [] });

function reglages(surcharge: Partial<ReglagesInvite> = {}): ReglagesInvite {
  return {
    ...reglagesParDefaut(null),
    modeles: { haiku: ['low', 'medium'] },
    machines: [MOI],
    simultanees: 2,
    ...surcharge,
  };
}

function entree(surcharge: Partial<EntreeVerdictClaude> = {}): EntreeVerdictClaude {
  return {
    reglages: reglages(),
    moi: MOI,
    methode: 'POST',
    chemin: '/v1/messages?beta=true',
    corps: CORPS_OK,
    session: 'session-1',
    sessionsRecentes: [],
    part: { ok: true },
    ...surcharge,
  };
}

describe('verdict d’une requête relayée', () => {
  test('un invité sur une machine permise, modèle et chemin permis : accepté', () => {
    const v = verdictRequeteClaude(entree());
    expect(v).toEqual({ ok: true, modele: 'claude-haiku-5-5', effort: null });
  });

  test('membre non invité : 403', () => {
    const v = verdictRequeteClaude(entree({ reglages: null }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect([v.statut, v.type]).toEqual([403, 'permission_error']);
  });

  test('ce nœud n’est pas dans les machines permises : 403', () => {
    expect(verdictRequeteClaude(entree({ reglages: reglages({ machines: [] }) })).ok).toBe(false);
  });

  test('chemin hors de la liste ou méthode non POST : 403', () => {
    expect(verdictRequeteClaude(entree({ chemin: '/v1/models' })).ok).toBe(false);
    expect(verdictRequeteClaude(entree({ methode: 'GET' })).ok).toBe(false);
  });

  test('modèle d’une famille non permise (opus) : 403', () => {
    const v = verdictRequeteClaude(entree({ corps: JSON.stringify({ model: 'claude-opus-5' }) }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.statut).toBe(403);
  });

  test('effort non permis pour la famille : 403 ; effort permis : accepté', () => {
    const haut = JSON.stringify({ model: 'claude-haiku-5-5', output_config: { effort: 'high' } });
    expect(verdictRequeteClaude(entree({ corps: haut })).ok).toBe(false);
    const moyen = JSON.stringify({ model: 'claude-haiku-5-5', output_config: { effort: 'medium' } });
    expect(verdictRequeteClaude(entree({ corps: moyen }))).toEqual({
      ok: true,
      modele: 'claude-haiku-5-5',
      effort: 'medium',
    });
  });

  test('part de la limite atteinte : 403 affiché, jamais 429 (réessayé en boucle)', () => {
    const v = verdictRequeteClaude(entree({ part: { ok: false, raison: 'part de la limite de 5 h atteinte' } }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect([v.statut, v.type]).toEqual([403, 'permission_error']);
  });

  test('corps illisible ou sans modèle : 400', () => {
    const v = verdictRequeteClaude(entree({ corps: '{pas du json' }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect([v.statut, v.type]).toEqual([400, 'invalid_request_error']);
    expect(verdictRequeteClaude(entree({ corps: '{}' })).ok).toBe(false);
  });

  test('une troisième session simultanée est refusée (403 affiché), une session déjà vue passe', () => {
    const deux = ['s-a', 's-b'];
    const nouvelle = verdictRequeteClaude(entree({ session: 's-c', sessionsRecentes: deux }));
    expect(nouvelle.ok).toBe(false);
    if (!nouvelle.ok) expect([nouvelle.statut, nouvelle.type]).toEqual([403, 'permission_error']);
    expect(verdictRequeteClaude(entree({ session: 's-a', sessionsRecentes: deux })).ok).toBe(true);
  });
});
