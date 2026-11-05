// Responsabilité : émettre un jeton d'accès au relais pour le MCP, sans mot de passe — à lancer SUR le Pi (compte pi),
// contre la base du relais. Seule l'empreinte est stockée ; le jeton s'affiche une fois sur stdout.
//   ssh pi 'sudo -u pi env $(sudo cat /mnt/hdd/ccremote/relais.env | grep ^CCREMOTE_BASE) \
//     /home/pi/.bun/bin/bun run - mcp-<appareil>' < mcp/emettre-jeton.ts
// Révoquer : DELETE FROM jetons WHERE appareil = 'mcp-<appareil>' dans la même base.
import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';

const DUREE_MS = 365 * 24 * 3600 * 1000;
const base = process.env['CCREMOTE_BASE'];
const appareil = process.argv.at(-1) ?? '';
if (!base || !/^mcp-[a-z0-9-]{1,40}$/.test(appareil)) {
  console.error('usage : CCREMOTE_BASE=… bun run emettre-jeton.ts mcp-<appareil>');
  process.exit(2);
}
const jeton = randomBytes(32).toString('base64url');
const db = new Database(base, { strict: true });
try {
  db.query('INSERT INTO jetons (empreinte, cree_le, expire_le, appareil) VALUES ($e, $c, $x, $a)').run({
    e: createHash('sha256').update(jeton).digest('hex'),
    c: new Date().toISOString(),
    x: new Date(Date.now() + DUREE_MS).toISOString(),
    a: appareil,
  });
} catch (e) {
  console.error(`insertion du jeton impossible : ${String(e)}`);
  process.exit(1);
} finally {
  db.close();
}
console.log(jeton);
