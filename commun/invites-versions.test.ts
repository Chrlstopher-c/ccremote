import { describe, expect, test } from 'bun:test';
import { effortApplique, reglagesParDefaut, versionPermise, type ReglagesInvite } from './invites.ts';

const base: ReglagesInvite = { ...reglagesParDefaut(null), modeles: { opus: ['low'], haiku: ['high'] } };

describe('versions permises par famille', () => {
  test('sans liste : toutes les versions de la famille', () => {
    expect(versionPermise(base, 'claude-opus-4-7')).toBe(true);
  });
  test('avec liste : seulement les identifiants exacts, suffixes de date et de fenêtre tolérés', () => {
    const r = { ...base, versions: { opus: ['claude-opus-5-5'] } };
    expect(versionPermise(r, 'claude-opus-5-5')).toBe(true);
    expect(versionPermise(r, 'claude-opus-5-5[1m]')).toBe(true);
    expect(versionPermise(r, 'claude-opus-5-5-20261101')).toBe(true);
    expect(versionPermise(r, 'claude-opus-4-7')).toBe(false);
    expect(versionPermise(r, 'claude-haiku-4-5')).toBe(true);
  });
  test('« claude-opus-5 » ne couvre pas « claude-opus-5-5 »', () => {
    expect(versionPermise({ ...base, versions: { opus: ['claude-opus-5'] } }, 'claude-opus-5-5')).toBe(false);
  });
  test('le relais refuse une version non permise', () => {
    const r = { ...base, versions: { opus: ['claude-opus-5-5'] } };
    expect(effortApplique(r, 'claude-opus-4-7', 'low').ok).toBe(false);
    expect(effortApplique(r, 'claude-opus-5-5', 'low').ok).toBe(true);
  });
});
