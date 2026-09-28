import { describe, expect, test } from 'bun:test';
import { paquetMagique } from './reveil.ts';

describe('paquet magique Wake-on-LAN', () => {
  test('102 octets : 6 × 0xFF puis 16 fois la MAC', () => {
    const p = paquetMagique('aa:bb:cc:dd:ee:ff');
    expect(p.length).toBe(102);
    expect([...p.subarray(0, 6)]).toEqual([255, 255, 255, 255, 255, 255]);
    expect([...p.subarray(96, 102)]).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  });

  test('tirets acceptés, MAC malformée refusée', () => {
    expect(paquetMagique('aa-bb-cc-dd-ee-ff').length).toBe(102);
    expect(() => paquetMagique('aa:bb:cc')).toThrow();
  });
});
