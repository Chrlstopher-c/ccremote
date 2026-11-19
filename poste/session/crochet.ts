// Responsabilité : relais des événements des hooks de Claude Code vers le poste, qui rend sa décision.
// Lancé par `bun crochet.ts <événement>` hors binaire, ou par `lanterne-moteur crochet <événement>` (binaire compilé).
// Ne bloque JAMAIS Claude : poste absent ou lent → sortie vide, code 0, Claude continue comme sans ccremote.

export async function relayerCrochet(evenement: string | undefined): Promise<string> {
  const session = process.env['CCREMOTE_SESSION'];
  const socket = process.env['CCREMOTE_SOCKET'];
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

export async function executerCrochet(evenement: string | undefined): Promise<void> {
  try {
    const sortie = await relayerCrochet(evenement);
    if (sortie && sortie !== '{}') process.stdout.write(sortie);
  } catch (erreur) {
    process.stderr.write(`ccremote : crochet ${evenement} non relayé (${String(erreur)})\n`);
  }
  process.exit(0);
}

if (import.meta.main) await executerCrochet(process.argv[2]);
