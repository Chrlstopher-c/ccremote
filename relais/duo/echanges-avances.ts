// Responsabilité : les échanges avancés du mode duo (étape 3) — passer la main, modules en commun, alertes de fichier
// touché des deux côtés et fil d'activité. Le lien, l'appairage et les partages restent dans duo.ts ; ce module reçoit
// ce qu'il lui faut et ne sait rien de la connexion.
import type { Database } from 'bun:sqlite';
import type { Logger } from 'pino';
import {
  type ActiviteDuo,
  type ConflitDuo,
  DELAI_MARGE_REPONSE_MS,
  type MessageLien,
  type ModuleDuo,
} from '../../commun/duo.ts';
import { DELAI_REQUETE_SERVEUR_MS, type RequeteServeur, type ReponseServeur } from '../../commun/modules.ts';
import type { Evenement } from '../../commun/session.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import { activiteDuo } from './activite.ts';
import type { Attentes } from './attentes.ts';
import type { Contexte } from './contexte.ts';
import { Conflits } from './conflits.ts';
import type { Demandes } from './demandes.ts';
import type { DroitsDuo } from './droits.ts';
import type { JournalDuo } from './journal.ts';
import { passerLaMain as passerLaMainVers } from './main.ts';
import { ModulesDuo } from './modules-duo.ts';
import type { PartagesDuo } from './partages.ts';
import type { Resultat } from './resultat.ts';

export interface DependancesEchanges {
  readonly base: Database;
  readonly registre: Registre;
  readonly postes: Pick<Postes, 'commander'>;
  readonly diffusion: Diffusion;
  readonly partages: PartagesDuo;
  readonly demandes: Demandes;
  readonly historique: JournalDuo;
  readonly droits: DroitsDuo;
  readonly attentes: Attentes;
  readonly contexte: Contexte;
  readonly horloge: () => number;
  readonly envoyer: (m: MessageLien) => boolean;
  readonly maintenant: () => string;
  readonly nomLocal: () => string;
  readonly nomPair: () => string;
  readonly log: Logger;
}

export class EchangesAvances {
  private readonly modules: ModulesDuo;
  private readonly conflits: Conflits;

  constructor(private readonly d: DependancesEchanges) {
    this.modules = new ModulesDuo({
      base: d.base,
      registre: d.registre,
      postes: d.postes,
      diffusion: d.diffusion,
      droits: d.droits,
      historique: d.historique,
      envoyer: d.envoyer,
      attentes: d.attentes,
      delaiServeurMs: DELAI_REQUETE_SERVEUR_MS + DELAI_MARGE_REPONSE_MS,
      nomPair: d.nomPair,
      maintenant: d.maintenant,
      log: d.log,
    });
    this.conflits = new Conflits({
      registre: d.registre,
      partages: d.partages,
      diffusion: d.diffusion,
      horloge: d.horloge,
      nomPair: d.nomPair,
    });
  }

  /** Donneur : la session part au pair ; rend l'identifiant de la session neuve chez lui. */
  passerLaMain(session: string, note: string | undefined): Promise<Resultat<string | null>> {
    return passerLaMainVers(this.d.contexte, session, note);
  }

  listerModules(): ModuleDuo[] {
    return this.modules.listerRecus();
  }

  accorderModule(id: string, accepte: boolean): Resultat<null> {
    return this.modules.accorder(id, accepte);
  }

  serveurDuPair(id: string, requete: RequeteServeur): Promise<Resultat<ReponseServeur>> {
    return this.modules.serveurDuPair(id, requete);
  }

  conflitsDuo(): ConflitDuo[] {
    return this.conflits.lister();
  }

  activite(): ActiviteDuo {
    return activiteDuo({
      registre: this.d.registre,
      partages: this.d.partages,
      demandes: this.d.demandes,
      journal: this.d.historique,
      nomLocal: this.d.nomLocal,
    });
  }

  /** Droits, partages ou modules locaux ont changé : l'offre et les mises à jour partent au pair. */
  synchroniser(): void {
    this.modules.synchroniser();
  }

  liaison(): void {
    this.modules.liaison();
  }

  fermee(): void {
    this.modules.fermee();
  }

  dissoudre(pair: string): void {
    this.modules.dissoudre(pair);
  }

  /** Un message du lien que les échanges de base n'ont pas pris : modules. Rend vrai s'il est traité. */
  traiter(pair: string, m: MessageLien): boolean {
    return this.modules.traiter(pair, m);
  }

  /** Un événement de session passe par ce relais (local ou du pair) : alertes de fichier touché des deux côtés. */
  observer(sessionId: string, evt: Evenement): void {
    this.conflits.observer(sessionId, evt);
  }
}
