// Responsabilité : comparer le dossier des modules à ce qui a déjà été envoyé au relais, et n'envoyer que la différence
// (module, module_erreur, module_retire). Un dossier illisible ne retire rien : on attend la prochaine lecture.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { MessagePoste } from '../../commun/protocole-poste.ts';
import { REGEX_ID_MODULE } from '../../commun/modules.ts';
import { validerModule } from './validation.ts';

export interface ParametresSource {
  readonly dossier: string;
  readonly envoyer: (m: MessagePoste) => void;
  readonly journal: Logger;
}

export class SourceModules {
  // Par identifiant : l'empreinte du dernier module envoyé, ou « erreur:… » pour une erreur déjà annoncée.
  private readonly envoye = new Map<string, string>();

  constructor(private readonly p: ParametresSource) {}

  /** Envoie ce qui a changé depuis le dernier passage. Rend le nombre de messages envoyés. */
  synchroniser(): number {
    const ids = this.identifiants();
    if (ids === null) return 0;
    let envois = 0;
    for (const id of ids) if (this.examiner(id)) envois += 1;
    for (const id of [...this.envoye.keys()]) {
      if (ids.includes(id)) continue;
      this.envoye.delete(id);
      this.p.envoyer({ kind: 'module_retire', id });
      envois += 1;
    }
    return envois;
  }

  private examiner(id: string): boolean {
    const r = validerModule(join(this.p.dossier, id), id);
    if (r.ok) {
      if (this.envoye.get(id) === r.module.empreinte) return false;
      this.envoye.set(id, r.module.empreinte);
      const fichiers = r.module.fichiers.map((f) => ({ chemin: f.chemin, base64: f.octets.toString('base64') }));
      this.p.envoyer({ kind: 'module', id, manifeste: r.module.manifeste, fichiers, empreinte: r.module.empreinte });
      return true;
    }
    const cle = `erreur:${r.erreur}`;
    if (this.envoye.get(id) === cle) return false;
    this.envoye.set(id, cle);
    this.p.journal.warn({ module: id, erreur: r.erreur }, 'module invalide, rien n’est envoyé au relais');
    this.p.envoyer({ kind: 'module_erreur', id, erreur: r.erreur });
    return true;
  }

  // Seuls les dossiers nommés comme un identifiant sont des modules ; `null` si le dossier est illisible.
  private identifiants(): string[] | null {
    if (!existsSync(this.p.dossier)) return [];
    try {
      return readdirSync(this.p.dossier, { withFileTypes: true })
        .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && REGEX_ID_MODULE.test(e.name))
        .map((e) => e.name);
    } catch (erreur) {
      this.p.journal.warn({ err: erreur, dossier: this.p.dossier }, 'dossier des modules illisible');
      return null;
    }
  }
}
