// Responsabilité : parcourir un fichier JSONL ligne à ligne par morceaux, sans jamais le charger en entier (un
// transcript de session géante dépasse 300 Mo). Une ligne coupée en fin de morceau attend la suite, en octets bruts
// pour ne pas casser un caractère UTF-8.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const MORCEAU = 4 * 1024 * 1024;

/** Suite d'un fichier lue depuis `depuis` ; rend la position atteinte et les octets d'une ligne non terminée. */
export function lireLignes(
  chemin: string,
  surLigne: (texte: string) => void,
  depuis = 0,
  reste: Buffer = Buffer.alloc(0),
): { lu: number; reste: Buffer } {
  const fd = openSync(chemin, 'r');
  let lu = depuis;
  let attente = reste;
  try {
    const fin = fstatSync(fd).size;
    const tampon = Buffer.allocUnsafe(MORCEAU);
    while (lu < fin) {
      const n = readSync(fd, tampon, 0, Math.min(MORCEAU, fin - lu), lu);
      if (n <= 0) break;
      lu += n;
      const octets = attente.length > 0 ? Buffer.concat([attente, tampon.subarray(0, n)]) : tampon.subarray(0, n);
      const dernier = octets.lastIndexOf(0x0a);
      if (dernier < 0) {
        attente = Buffer.from(octets);
        continue;
      }
      attente = Buffer.from(octets.subarray(dernier + 1));
      for (const texte of octets.subarray(0, dernier).toString('utf8').split('\n')) surLigne(texte);
    }
  } finally {
    closeSync(fd);
  }
  return { lu, reste: attente };
}
