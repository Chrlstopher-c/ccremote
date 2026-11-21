// Responsabilité : côté pair, les modules que le propriétaire propose. Une table garde l'offre et les accords ; un
// module accepté est enregistré dans le registre des modules sous `duo:<utilisateur>` (lecture seule). Son serveur
// tourne chez le propriétaire : la requête part par le lien.
import type { Database } from 'bun:sqlite';
import { estModuleDuo, machineDuo, type MessageLien, type ModuleDuo, type OffreModule } from '../../commun/duo.ts';
import type {
  EtatServeur,
  FichierModule,
  ManifesteModule,
  RequeteServeur,
  ReponseServeur,
} from '../../commun/modules.ts';
import { CONFLIT_LOCAL } from '../modules/registre-modules.ts';
import type { Registre } from '../registre/registre.ts';
import type { Attentes } from './attentes.ts';
import { echec, ok, type Resultat } from './resultat.ts';

interface LigneOffre {
  id: string;
  pair: string;
  nom: string;
  version: string;
  description: string;
  accepte: number;
}

export interface DependancesRecus {
  readonly base: Database;
  readonly registre: Registre;
  readonly envoyer: (m: MessageLien) => boolean;
  readonly attentes: Attentes;
  readonly delaiMs: number;
  readonly nouvelleRef: () => string;
}

export class ModulesRecus {
  constructor(private readonly d: DependancesRecus) {
    d.base.exec(`CREATE TABLE IF NOT EXISTS duo_modules (
      id TEXT PRIMARY KEY, pair TEXT NOT NULL, nom TEXT NOT NULL, version TEXT NOT NULL,
      description TEXT NOT NULL, accepte INTEGER NOT NULL DEFAULT 0)`);
  }

  lister(): ModuleDuo[] {
    const lignes = this.d.base.query('SELECT * FROM duo_modules ORDER BY nom, id').all() as LigneOffre[];
    return lignes.map((l) => ({
      id: l.id,
      nom: l.nom,
      version: l.version,
      description: l.description,
      accepte: l.accepte === 1,
      erreur: this.erreurDe(l.id),
    }));
  }

  /** Une offre complète : ce qui n'y figure plus disparaît (table et registre) ; les accords restent. */
  recevoirOffre(pair: string, modules: readonly OffreModule[]): void {
    const ids = new Set(modules.map((m) => m.id));
    const lignes = this.d.base.query('SELECT id FROM duo_modules WHERE pair = $p').all({ p: pair }) as { id: string }[];
    for (const { id } of lignes) {
      if (ids.has(id)) continue;
      this.d.base.query('DELETE FROM duo_modules WHERE id = $id').run({ id });
      this.d.registre.modules.retirer(id, machineDuo(pair));
    }
    for (const m of modules) {
      this.d.base
        .query(
          `INSERT INTO duo_modules (id, pair, nom, version, description, accepte) VALUES ($id, $p, $nom, $v, $d, 0)
           ON CONFLICT(id) DO UPDATE SET pair = $p, nom = $nom, version = $v, description = $d`,
        )
        .run({ id: m.id, p: pair, nom: m.nom, v: m.version, d: m.description });
    }
  }

  /** Le pair accepte ou retire un module proposé : l'accord part au propriétaire. */
  accorder(id: string, accepte: boolean): Resultat<null> {
    const ligne = this.ligne(id);
    if (!ligne) return echec(404, 'module non proposé');
    this.d.base.query('UPDATE duo_modules SET accepte = $a WHERE id = $id').run({ a: accepte ? 1 : 0, id });
    if (!accepte) this.d.registre.modules.retirer(id, machineDuo(ligne.pair));
    this.d.envoyer({ type: 'module_accord', id, accepte });
    return ok(null);
  }

  /** Lien rétabli : chaque module accepté est redemandé au propriétaire. */
  liaison(): void {
    const acceptes = this.d.base.query('SELECT id FROM duo_modules WHERE accepte = 1').all() as { id: string }[];
    for (const { id } of acceptes) this.d.envoyer({ type: 'module_accord', id, accepte: true });
  }

  /** Contenu d'un module accepté : enregistré sous la machine du pair ; rend vrai si le registre a changé. */
  recevoirContenu(
    pair: string,
    m: { manifeste: ManifesteModule; empreinte: string; fichiers: readonly FichierModule[] },
  ): boolean {
    const ligne = this.ligne(m.manifeste.id);
    if (!ligne || ligne.pair !== pair || ligne.accepte !== 1) return false;
    return this.d.registre.modules.enregistrer(machineDuo(pair), {
      kind: 'module',
      id: m.manifeste.id,
      manifeste: m.manifeste,
      fichiers: [...m.fichiers],
      empreinte: m.empreinte,
    });
  }

  recevoirRetrait(pair: string, id: string): boolean {
    const ligne = this.ligne(id);
    if (!ligne || ligne.pair !== pair) return false;
    return this.d.registre.modules.retirer(id, machineDuo(pair));
  }

  recevoirEtat(pair: string, id: string, etat: EtatServeur, erreur: string | null): boolean {
    const ligne = this.ligne(id);
    if (!ligne || ligne.pair !== pair || ligne.accepte !== 1) return false;
    return this.d.registre.modules.serveurMaj(id, { etat, erreur });
  }

  /** Révocation : plus aucune offre, plus aucun module du pair. */
  retirerTout(pair: string): void {
    this.d.base.query('DELETE FROM duo_modules WHERE pair = $p').run({ p: pair });
    this.d.registre.modules.retirerDuPair(pair);
  }

  /** Requête au serveur d'un module reçu : part au propriétaire, la réponse revient par son identifiant. */
  async serveur(id: string, requete: RequeteServeur): Promise<Resultat<ReponseServeur>> {
    const ligne = this.ligne(id);
    if (!ligne || ligne.accepte !== 1) return echec(503, 'module non accepté');
    const ref = this.d.nouvelleRef();
    const message: MessageLien = { type: 'serveur_requete', ref, id, requete };
    const reponse = await this.d.attentes.requete(ref, message, this.d.envoyer, this.d.delaiMs);
    if (!reponse) return echec(503, `pas de réponse de ${ligne.pair}`);
    if (reponse.type !== 'serveur_reponse') return echec(503, 'réponse inattendue');
    return reponse.reponse ? ok(reponse.reponse) : echec(503, reponse.raison ?? 'serveur indisponible');
  }

  private ligne(id: string): LigneOffre | null {
    return (this.d.base.query('SELECT * FROM duo_modules WHERE id = $id').get({ id }) as LigneOffre | null) ?? null;
  }

  // Un module reçu du pair n'a pas d'erreur propre : un conflit vient d'un module local de même identifiant.
  private erreurDe(id: string): string | null {
    const r = this.d.registre.modules.obtenir(id);
    if (r === null) return null;
    if (!estModuleDuo(r.machine)) return CONFLIT_LOCAL;
    return r.erreur;
  }
}
