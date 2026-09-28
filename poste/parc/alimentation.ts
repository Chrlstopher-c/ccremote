// Responsabilité : éteindre la machine du poste à la demande de Chris.
import type { Logger } from 'pino';

export async function eteindreMachine(journal: Logger): Promise<{ ok: boolean; erreur?: string }> {
  journal.warn('extinction demandée');
  const p = Bun.spawn(['systemctl', 'poweroff'], { stderr: 'pipe' });
  const code = await p.exited;
  if (code === 0) return { ok: true };
  const erreur = (await new Response(p.stderr).text()).trim() || `systemctl poweroff : code ${code}`;
  journal.error({ erreur }, 'extinction refusée');
  return { ok: false, erreur };
}
