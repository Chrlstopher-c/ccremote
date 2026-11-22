// Responsabilité : un PNG de test (RVB 8 bits, bruit déterministe), valide et de quelques centaines de Ko — pour les
// bancs qui vérifient qu'une image traverse le canal intacte.
import { deflateSync } from 'node:zlib';

/** Un PNG RVB 8 bits, de `cote` × `cote` pixels, de bruit déterministe : valide, et de quelques centaines de Ko. */
export function pngDeBruit(cote: number): Uint8Array {
  const ligne = 1 + cote * 3;
  const brut = new Uint8Array(ligne * cote);
  let graine = 0x2545f491;
  for (let i = 0; i < brut.length; i++) {
    graine ^= graine << 13;
    graine ^= graine >>> 17;
    graine ^= graine << 5;
    brut[i] = graine & 0xff;
  }
  for (let y = 0; y < cote; y++) brut[y * ligne] = 0;
  const entete = new Uint8Array(13);
  const vue = new DataView(entete.buffer);
  vue.setUint32(0, cote);
  vue.setUint32(4, cote);
  entete[8] = 8;
  entete[9] = 2;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat([signature, bloc('IHDR', entete), bloc('IDAT', deflateSync(brut)), bloc('IEND', new Uint8Array())]);
}

function bloc(type: string, donnees: Uint8Array): Uint8Array {
  const sortie = new Uint8Array(12 + donnees.length);
  const vue = new DataView(sortie.buffer);
  vue.setUint32(0, donnees.length);
  sortie.set(new TextEncoder().encode(type), 4);
  sortie.set(donnees, 8);
  vue.setUint32(8 + donnees.length, crc32(sortie.subarray(4, 8 + donnees.length)));
  return sortie;
}

function crc32(octets: Uint8Array): number {
  let c = 0xffffffff;
  for (const o of octets) {
    c ^= o;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function concat(morceaux: Uint8Array[]): Uint8Array {
  const total = morceaux.reduce((n, m) => n + m.length, 0);
  const sortie = new Uint8Array(total);
  let decalage = 0;
  for (const m of morceaux) {
    sortie.set(m, decalage);
    decalage += m.length;
  }
  return sortie;
}
