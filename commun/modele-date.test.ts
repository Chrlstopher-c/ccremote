import { describe, expect, test } from 'bun:test';
import { plusRecent, plusRecentOpt } from './modele-date.ts';

const ANCIEN = { modele: 'claude-fable-5-2', le: '2026-11-20T23:00:00.000Z' };
const RECENT = { modele: 'claude-opus-5-5', le: '2026-11-20T23:28:25.000Z' };

describe('plusRecent', () => {
  test('le plus récent gagne, quel que soit l ordre des sources', () => {
    expect(plusRecent(ANCIEN, RECENT)).toBe(RECENT);
    expect(plusRecent(RECENT, ANCIEN)).toBe(RECENT);
  });

  test('un instant absent perd contre un instant connu ; à égalité, la première source', () => {
    const sansDate = { modele: 'claude-haiku-5-5', le: null };
    expect(plusRecent(sansDate, ANCIEN)).toBe(ANCIEN);
    expect(plusRecent(ANCIEN, sansDate)).toBe(ANCIEN);
    expect(plusRecent(ANCIEN, { ...RECENT, le: ANCIEN.le })).toBe(ANCIEN);
  });
});

describe('plusRecentOpt', () => {
  test('une source absente cède la place à l autre ; deux absentes donnent null', () => {
    expect(plusRecentOpt(null, RECENT)).toBe(RECENT);
    expect(plusRecentOpt(ANCIEN, null)).toBe(ANCIEN);
    expect(plusRecentOpt(null, null)).toBeNull();
  });
});
