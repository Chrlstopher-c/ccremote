// Responsabilité : commandes de configuration exécutées sur le poste, hors de toute session.
// un échec rend un code négatif et le détail est journalisé.
import type { Logger } from 'pino';
import { binaireClaude } from '../session/lanceur.ts';

export interface SortieCommande {
  readonly code: number;
  readonly sortie: string;
  readonly erreurs: string;
  readonly delaiDepasse: boolean;
}

export type LanceurClaude = (args: readonly string[]) => Promise<SortieCommande>;

export function lanceurClaude(delaiMs: number, journal: Logger): LanceurClaude {
  return (args) => executerClaude(args, delaiMs, journal);
}

async function executerClaude(args: readonly string[], delaiMs: number, journal: Logger): Promise<SortieCommande> {
  try {
    const processus = Bun.spawn([binaireClaude(), ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const delai = new Promise<'delai'>((resoudre) => {
      minuteur = setTimeout(() => {
        processus.kill();
        resoudre('delai');
      }, delaiMs);
    });
    const fin = Promise.all([
      new Response(processus.stdout).text(),
      new Response(processus.stderr).text(),
      processus.exited,
    ]);
    const issue = await Promise.race([fin, delai]);
    clearTimeout(minuteur);
    if (typeof issue === 'string') return { code: -1, sortie: '', erreurs: '', delaiDepasse: true };
    const [sortie, erreurs, code] = issue;
    return { code, sortie, erreurs, delaiDepasse: false };
  } catch (erreur) {
    journal.warn({ err: erreur, args }, 'commande claude impossible');
    return { code: -1, sortie: '', erreurs: String(erreur), delaiDepasse: false };
  }
}

export function messageEchec(r: SortieCommande): string {
  if (r.delaiDepasse) return 'délai dépassé';
  return r.erreurs.trim().split('\n').at(-1) || `claude a échoué (code ${r.code})`;
}
