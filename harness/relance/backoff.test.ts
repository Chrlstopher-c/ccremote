import { describe, expect, test } from 'bun:test';
import { delaiBackoffMs } from './backoff.ts';

describe('delaiBackoffMs', () => {
  test('double à chaque tentative', () => {
    expect(delaiBackoffMs(1)).toBe(1_000);
    expect(delaiBackoffMs(2)).toBe(2_000);
    expect(delaiBackoffMs(3)).toBe(4_000);
    expect(delaiBackoffMs(4)).toBe(8_000);
  });

  test('plafonne à 60 s même après de nombreuses tentatives', () => {
    expect(delaiBackoffMs(10)).toBe(60_000);
    expect(delaiBackoffMs(50)).toBe(60_000);
  });

  test('rejette une tentative < 1', () => {
    expect(() => delaiBackoffMs(0)).toThrow(RangeError);
    expect(() => delaiBackoffMs(-1)).toThrow(RangeError);
  });
});
