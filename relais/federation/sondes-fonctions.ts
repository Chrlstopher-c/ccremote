// Responsabilité : les sondes « voix » et « dictée » de cette machine pour l'état du nœud (Paramètres › Réseau) —
// l'unité utilisateur systemd existe-t-elle, tourne-t-elle. Lecture seule ; hors Linux, ou systemctl absent : absente.
import type { Logger } from 'pino';
import type { EtatFonctionNoeud, FonctionsNoeud } from './etat-federation.ts';

const DELAI_MS = 3000;

async function sonderUnite(unite: string, journal: Logger): Promise<EtatFonctionNoeud> {
  if (process.platform !== 'linux' || !Bun.which('systemctl')) return 'absente';
  try {
    const p = Bun.spawn(['systemctl', '--user', 'show', unite, '-p', 'LoadState', '-p', 'ActiveState'], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const minuterie = setTimeout(() => p.kill(), DELAI_MS);
    const sortie = await new Response(p.stdout).text();
    clearTimeout(minuterie);
    if (!/LoadState=loaded/.test(sortie)) return 'absente';
    return /ActiveState=(active|activating|reloading)/.test(sortie) ? 'lancee' : 'arretee';
  } catch (erreur) {
    journal.warn({ err: erreur, unite }, 'sonde systemd en échec');
    return 'absente';
  }
}

/** Unités par défaut : `lanterne-voix` et `whisper` (dictée), surchargeables par l'environnement. */
export function sondesFonctions(env: Record<string, string | undefined>, journal: Logger): FonctionsNoeud {
  const voix = env['LANTERNE_UNITE_VOIX'] ?? 'lanterne-voix';
  const dictee = env['LANTERNE_UNITE_DICTEE'] ?? 'whisper';
  return { voix: () => sonderUnite(voix, journal), dictee: () => sonderUnite(dictee, journal) };
}
