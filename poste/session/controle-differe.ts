// Responsabilité : le Remote Control demandé à la création d’une session, branché dès que la session est au repos.
// on la rejoue donc à chaque passage du poste jusqu'à ce que la session soit au repos. Réutilise la bascule existante.
import { basculerControle, type GestionBascule } from './bascule-controle.ts';
import type { SessionPoste } from './session-poste.ts';

export class ControlesDifferes {
  private readonly attente = new Set<string>();

  ajouter(id: string): void {
    this.attente.add(id);
  }

  async traiter(g: GestionBascule): Promise<void> {
    for (const id of [...this.attente]) {
      const s = g.sessions.get(id);
      if (!s) {
        this.attente.delete(id);
        continue;
      }
      if (!estAuRepos(s)) continue;
      const r = await basculerControle(g, id, true);
      if (!r.ok && /occupée|en cours/.test(r.erreur ?? '')) continue;
      this.attente.delete(id);
      if (!r.ok) g.journal.warn({ session: id, erreur: r.erreur }, 'Remote Control demandé à la création : échec');
    }
  }
}

export function estAuRepos(s: SessionPoste): boolean {
  return s.resume.statut !== 'travail' && s.resume.statut !== 'compaction' && !s.resume.dialogue;
}
