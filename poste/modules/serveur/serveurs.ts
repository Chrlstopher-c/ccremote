// Responsabilité : les serveurs des modules de CE poste — lance, redémarre ou arrête le serveur de chaque module selon
// son manifeste (`serveur.machine`, par défaut la machine qui publie) et ses fichiers serveur/ ; relaie les requêtes du
// relais ; annonce chaque changement d'état (`module_serveur`). Un module retiré ou invalide n'a plus de serveur.
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { EtatServeur, RequeteServeur } from '../../../commun/modules.ts';
import type { MessagePoste } from '../../../commun/protocole-poste.ts';
import type { ModuleValide } from '../validation.ts';
import { commandeSysteme, empreinteServeur } from './lancement.ts';
import { ProcessusServeur, type ReglagesProcessus } from './processus.ts';
import { type ResultatServeur, requeteServeur } from './requete.ts';

export const DOSSIER_DONNEES_MODULES = join(homedir(), '.local', 'share', 'lanterne', 'modules-donnees');
export const DOSSIER_JOURNAUX_MODULES = join(homedir(), '.local', 'share', 'lanterne', 'modules-journal');

export const DELAIS_RELANCE_MS = [1_000, 5_000, 30_000];
export const DELAI_PRET_MS = 10_000;
export const DELAI_STABLE_MS = 60_000;
export const DELAI_ARRET_MS = 5_000;

export interface ParamsServeurs {
  readonly machine: string;
  readonly dossierDonnees: string; // MODULE_DONNEES = <dossierDonnees>/<id>
  readonly dossierJournaux: string; // <id>-serveur.log
  readonly envoyer: (m: MessagePoste) => void;
  readonly journal: Logger;
  readonly reglages?: Partial<ReglagesProcessus>;
}

const REGLAGES_PAR_DEFAUT: ReglagesProcessus = {
  commande: commandeSysteme,
  delais: DELAIS_RELANCE_MS,
  delaiPretMs: DELAI_PRET_MS,
  delaiStableMs: DELAI_STABLE_MS,
  delaiArretMs: DELAI_ARRET_MS,
};

export class ServeursModules {
  private readonly processus = new Map<string, ProcessusServeur>();
  private readonly reglages: ReglagesProcessus;

  constructor(private readonly p: ParamsServeurs) {
    this.reglages = { ...REGLAGES_PAR_DEFAUT, ...p.reglages };
  }

  /** Aligne le serveur du module : lancé, redémarré si son code a changé, arrêté s'il n'est plus à ce poste. */
  synchroniser(id: string, dossier: string, module: ModuleValide): void {
    const serveur = module.manifeste.serveur;
    if (serveur === undefined || (serveur.machine ?? this.p.machine) !== this.p.machine) {
      void this.arreter(id);
      return;
    }
    const empreinte = empreinteServeur(module.fichiers);
    const existant = this.processus.get(id);
    if (existant === undefined) {
      this.creer(id, dossier, serveur.point, empreinte);
    } else if (existant.empreinte !== empreinte) {
      void existant.redemarrer(empreinte);
    }
  }

  /** Arrête le serveur du module (retiré, invalide, ou plus à ce poste). Sans serveur, ne fait rien. */
  arreter(id: string): Promise<void> {
    const proc = this.processus.get(id);
    if (proc === undefined) return Promise.resolve();
    this.processus.delete(id);
    return proc.arreter();
  }

  async arreterTout(): Promise<void> {
    await Promise.all([...this.processus.keys()].map((id) => this.arreter(id)));
  }

  /** Relaie la requête au serveur du module : refus lisible si ce poste n'en fait pas tourner un qui réponde. */
  async requete(id: string, requete: RequeteServeur): Promise<ResultatServeur> {
    const proc = this.processus.get(id);
    if (proc === undefined) return { ok: false, erreur: 'aucun serveur pour ce module sur cette machine' };
    const { etat, erreur } = proc.etat();
    if (etat !== 'pret') return { ok: false, erreur: raisonIndisponible(etat, erreur) };
    return requeteServeur(proc.portEcoute(), requete, this.p.journal);
  }

  /** Renvoie au relais l'état de chaque serveur (à la reconnexion : le relais peut l'avoir perdu). */
  republier(): void {
    for (const proc of this.processus.values()) proc.republier();
  }

  private creer(id: string, dossier: string, point: string, empreinte: string): void {
    const proc = new ProcessusServeur({
      id,
      dossier,
      point,
      donnees: join(this.p.dossierDonnees, id),
      fichierJournal: join(this.p.dossierJournaux, `${id}-serveur.log`),
      reglages: this.reglages,
      surEtat: (etat, erreur) => this.annoncer(id, etat, erreur),
      journal: this.p.journal.child({ module: id }),
    });
    this.processus.set(id, proc);
    void proc.demarrer(empreinte);
  }

  private annoncer(id: string, etat: EtatServeur, erreur: string | undefined): void {
    this.p.envoyer({ kind: 'module_serveur', id, etat, ...(erreur ? { erreur } : {}) });
  }
}

function raisonIndisponible(etat: EtatServeur, erreur: string | undefined): string {
  if (etat === 'panne') return `serveur en panne : ${erreur ?? 'raison inconnue'}`;
  if (etat === 'demarrage') return 'serveur en cours de démarrage';
  return 'serveur arrêté';
}
