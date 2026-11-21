// Responsabilité : les requêtes d'un poste au relais (`requete_relais`, outils de modules v1.1) — traitées comme les
// routes HTTP (modules/api-appels.ts), rendues en `reponse_relais` au même id. Une erreur reste une réponse.
import type { Logger } from 'pino';
import type { QuoiRelais, ReponseRelais } from '../../commun/modules.ts';

export type SurRequeteRelais = (quoi: QuoiRelais, args: unknown) => Promise<ReponseRelais>;

interface RequetePoste {
  readonly id: string;
  readonly quoi: QuoiRelais;
  readonly args?: unknown;
}

export class RequetesPostes {
  /** Le traitement des requêtes, posé par bin.ts. Absent : chaque requête reçoit un refus lisible. */
  surRequete: SurRequeteRelais | null = null;

  async recevoir(ws: { send(texte: string): unknown } | undefined, m: RequetePoste, journal: Logger): Promise<void> {
    const r = await this.traiter(m, journal);
    ws?.send(JSON.stringify({ kind: 'reponse_relais', id: m.id, ...r }));
  }

  private async traiter(m: RequetePoste, journal: Logger): Promise<ReponseRelais> {
    if (!this.surRequete) return { ok: false, erreur: 'outils de modules indisponibles sur ce relais' };
    try {
      return await this.surRequete(m.quoi, m.args);
    } catch (erreur) {
      journal.error({ err: erreur, quoi: m.quoi }, 'requête de poste en échec');
      return { ok: false, erreur: 'erreur interne du relais' };
    }
  }
}
