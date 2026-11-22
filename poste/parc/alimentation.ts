// Responsabilité : éteindre la machine du poste à la demande de Chris.
import type { Logger } from 'pino';

/** La commande d'extinction : systemctl sous Linux ; sous macOS, arrêt demandé à Finder (sans sudo). */
export function commandeExtinction(plateforme: NodeJS.Platform = process.platform): string[] {
  if (plateforme === 'darwin') return ['osascript', '-e', 'tell application "System Events" to shut down'];
  return ['systemctl', 'poweroff'];
}

export async function eteindreMachine(journal: Logger): Promise<{ ok: boolean; erreur?: string }> {
  journal.warn('extinction demandée');
  const commande = commandeExtinction();
  const p = Bun.spawn(commande, { stderr: 'pipe' });
  const code = await p.exited;
  if (code === 0) return { ok: true };
  const erreur = (await new Response(p.stderr).text()).trim() || `${commande.join(' ')} : code ${code}`;
  journal.error({ erreur }, 'extinction refusée');
  return { ok: false, erreur };
}
