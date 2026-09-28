// Responsabilité : script lancé par les hooks de Claude Code — relaie l'événement au poste et rend sa décision.
export {}; // module : permet l’await de premier niveau
// Ne bloque JAMAIS Claude : poste absent ou lent → sortie vide, code 0, Claude continue comme sans ccremote.
const [evenement] = process.argv.slice(2);
const session = process.env['CCREMOTE_SESSION'];
const socket = process.env['CCREMOTE_SOCKET'];

async function relayer(): Promise<string> {
  if (!evenement || !session || !socket) return '';
  const corps = await Bun.stdin.text();
  const r = await fetch(`http://poste/crochet/${evenement}?session=${encodeURIComponent(session)}`, {
    method: 'POST',
    body: corps,
    unix: socket,
    signal: AbortSignal.timeout(20_000),
  } as RequestInit);
  return r.ok ? r.text() : '';
}

try {
  const sortie = await relayer();
  if (sortie && sortie !== '{}') process.stdout.write(sortie);
} catch (erreur) {
  process.stderr.write(`ccremote : crochet ${evenement} non relayé (${String(erreur)})\n`);
}
process.exit(0);
