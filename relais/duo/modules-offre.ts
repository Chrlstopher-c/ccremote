// Responsabilité : côté propriétaire, les modules en commun. Il propose ses modules listés dans `modulesPartages`,
// envoie le contenu de ceux que le pair accepte (et sa mise à jour, son état de serveur), retire ce qui n'est plus
// partagé, et relaie les requêtes au serveur d'un module vers le poste de sa machine.
import { estModuleDuo, type MessageLien, type OffreModule } from '../../commun/duo.ts';
import type { RequeteServeur } from '../../commun/modules.ts';
import type { Postes } from '../parc/postes.ts';
import type { ModuleRelais } from '../modules/registre-modules.ts';
import type { Registre } from '../registre/registre.ts';
import { executerServeur } from '../modules/api-serveur.ts';
import type { DroitsDuo } from './droits.ts';
import type { JournalDuo } from './journal.ts';

export interface DependancesOffre {
  readonly registre: Registre;
  readonly postes: Pick<Postes, 'commander'>;
  readonly droits: DroitsDuo;
  readonly historique: JournalDuo;
  readonly envoyer: (m: MessageLien) => boolean;
  readonly nomPair: () => string;
  readonly maintenant: () => string;
}

interface Suivi {
  empreinte: string | null;
  serveur: string | null;
}

export class OffreModules {
  // Modules que le pair a acceptés, avec ce qu'on lui a déjà envoyé (une mise à jour n'est poussée qu'une fois).
  private readonly abonnes = new Map<string, Suivi>();
  private offreEnvoyee: string | null = null;

  constructor(private readonly d: DependancesOffre) {}

  /** Les modules locaux que le propriétaire partage : ce que le pair voit dans sa liste. */
  offre(): OffreModule[] {
    const partages = new Set(this.d.droits.lire().modulesPartages);
    return this.d.registre.modules.lister().flatMap((m) => {
      const manifeste = m.manifeste;
      if (!partages.has(m.id) || estModuleDuo(m.machine) || m.erreur !== null) return [];
      if (manifeste === null || m.empreinte === null) return [];
      const { nom, version, description } = manifeste;
      return [{ id: m.id, nom, version, description, empreinte: m.empreinte }];
    });
  }

  /** Propose l'offre si elle a changé, et pousse à chaque module accepté ce qui a changé depuis. */
  synchroniser(): void {
    const offre = this.offre();
    const json = JSON.stringify(offre);
    if (json !== this.offreEnvoyee) this.envoyerOffre(offre, json);
    for (const id of [...this.abonnes.keys()]) this.pousser(id, offre);
  }

  /** Le pair accepte (ou retire) un module de l'offre. */
  accord(id: string, accepte: boolean): void {
    if (!this.offre().some((o) => o.id === id)) return this.journaliser('module_accord', id, 'refusé : non partagé');
    if (!accepte) {
      this.abonnes.delete(id);
      return this.journaliser('module_accord', id, 'retiré par le pair');
    }
    this.abonnes.set(id, { empreinte: null, serveur: null });
    this.journaliser('module_accord', id, 'accepté');
    this.pousser(id, this.offre());
  }

  /** Lien (re)établi : le pair renvoie ses accords, on repart d'une offre et de contenus frais. */
  liaison(): void {
    this.abonnes.clear();
    this.offreEnvoyee = null;
    this.synchroniser();
  }

  fermee(): void {
    this.abonnes.clear();
    this.offreEnvoyee = null;
  }

  /** Requête au serveur d'un module du propriétaire, venue du pair : seulement pour un module qu'il a accepté. */
  async serveur(ref: string, id: string, requete: RequeteServeur): Promise<void> {
    if (!this.abonnes.has(id)) {
      this.journaliser('serveur_module', id, 'refusé : module non accepté');
      this.d.envoyer({ type: 'serveur_reponse', ref, reponse: null, raison: 'module non accepté' });
      return;
    }
    const r = await executerServeur(this.d.registre, this.d.postes, id, requete);
    this.journaliser('serveur_module', id, `${requete.method ?? 'GET'} ${requete.chemin}`);
    this.d.envoyer(
      r.ok
        ? { type: 'serveur_reponse', ref, reponse: r.valeur }
        : { type: 'serveur_reponse', ref, reponse: null, raison: r.raison },
    );
  }

  private envoyerOffre(offre: readonly OffreModule[], json: string): void {
    if (this.d.envoyer({ type: 'modules_offre', modules: [...offre] })) this.offreEnvoyee = json;
  }

  private pousser(id: string, offre: readonly OffreModule[]): void {
    const suivi = this.abonnes.get(id);
    if (!suivi) return;
    if (!offre.some((o) => o.id === id)) {
      this.abonnes.delete(id);
      this.d.envoyer({ type: 'module_retire', id });
      return;
    }
    const module = this.d.registre.modules.obtenir(id);
    if (module === null || module.erreur !== null) return;
    if (suivi.empreinte !== module.empreinte && this.envoyerContenu(module)) suivi.empreinte = module.empreinte;
    this.pousserEtat(id, module, suivi);
  }

  private pousserEtat(id: string, module: ModuleRelais, suivi: Suivi): void {
    if (module.serveur === null) return;
    const json = JSON.stringify(module.serveur);
    if (json === suivi.serveur) return;
    const { etat, erreur } = module.serveur;
    if (this.d.envoyer({ type: 'module_serveur', id, etat, erreur })) suivi.serveur = json;
  }

  private envoyerContenu(module: ModuleRelais): boolean {
    const manifeste = module.manifeste;
    if (manifeste === null || module.empreinte === null) return false;
    const fichiers = module.fichiers.flatMap((chemin) => {
      const f = this.d.registre.modules.fichier(module.id, chemin);
      return f ? [f] : [];
    });
    return this.d.envoyer({ type: 'module_contenu', manifeste, empreinte: module.empreinte, fichiers });
  }

  private journaliser(action: string, id: string, detail: string): void {
    this.d.historique.ecrire({ le: this.d.maintenant(), qui: this.d.nomPair(), action, cible: id, detail });
  }
}
