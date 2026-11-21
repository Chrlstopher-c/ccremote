// Responsabilité : les modules en commun côté relais — la façade qui relie le lien aux deux rôles : propriétaire
// (offre, contenu, serveur relayé) et pair (modules reçus). Chaque message de module part vers son rôle.
import type { Database } from 'bun:sqlite';
import type { Logger } from 'pino';
import type { MessageLien, ModuleDuo } from '../../commun/duo.ts';
import type { RequeteServeur, ReponseServeur } from '../../commun/modules.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import type { Attentes } from './attentes.ts';
import type { DroitsDuo } from './droits.ts';
import type { JournalDuo } from './journal.ts';
import { ModulesRecus } from './modules-recus.ts';
import { OffreModules } from './modules-offre.ts';
import { nonce } from './preuve.ts';
import type { Resultat } from './resultat.ts';

export interface DependancesModules {
  readonly base: Database;
  readonly registre: Registre;
  readonly postes: Pick<Postes, 'commander'>;
  readonly diffusion: Diffusion;
  readonly droits: DroitsDuo;
  readonly historique: JournalDuo;
  readonly envoyer: (m: MessageLien) => boolean;
  readonly attentes: Attentes;
  readonly delaiServeurMs: number;
  readonly nomPair: () => string;
  readonly maintenant: () => string;
  readonly log: Logger;
}

export class ModulesDuo {
  private readonly offre: OffreModules;
  private readonly recus: ModulesRecus;

  constructor(private readonly d: DependancesModules) {
    this.offre = new OffreModules({
      registre: d.registre,
      postes: d.postes,
      droits: d.droits,
      historique: d.historique,
      envoyer: d.envoyer,
      nomPair: d.nomPair,
      maintenant: d.maintenant,
    });
    this.recus = new ModulesRecus({
      base: d.base,
      registre: d.registre,
      envoyer: d.envoyer,
      attentes: d.attentes,
      delaiMs: d.delaiServeurMs,
      nouvelleRef: nonce,
    });
  }

  listerRecus(): ModuleDuo[] {
    return this.recus.lister();
  }

  accorder(id: string, accepte: boolean): Resultat<null> {
    const r = this.recus.accorder(id, accepte);
    this.d.diffusion.diffuser({ type: 'duo_modifie' });
    return r;
  }

  serveurDuPair(id: string, requete: RequeteServeur): Promise<Resultat<ReponseServeur>> {
    return this.recus.serveur(id, requete);
  }

  /** Droits, partages ou modules locaux ont changé : l'offre et les mises à jour partent au pair. */
  synchroniser(): void {
    this.offre.synchroniser();
  }

  liaison(): void {
    this.offre.liaison();
    this.recus.liaison();
  }

  fermee(): void {
    this.offre.fermee();
  }

  /** Révocation : les modules reçus du pair disparaissent. */
  dissoudre(pair: string): void {
    this.recus.retirerTout(pair);
    this.d.diffusion.diffuser({ type: 'modules_modifies' });
  }

  /** Rend vrai si le message relève des modules (et est traité). */
  traiter(pair: string, m: MessageLien): boolean {
    switch (m.type) {
      case 'modules_offre':
        this.recus.recevoirOffre(pair, m.modules);
        return this.apres(false, true);
      case 'module_contenu':
        return this.apres(this.recus.recevoirContenu(pair, m), false);
      case 'module_retire':
        return this.apres(this.recus.recevoirRetrait(pair, m.id), false);
      case 'module_serveur':
        return this.apres(this.recus.recevoirEtat(pair, m.id, m.etat, m.erreur), false);
      case 'module_accord':
        this.offre.accord(m.id, m.accepte);
        return this.apres(false, true);
      case 'serveur_requete':
        this.offre.serveur(m.ref, m.id, m.requete).catch((erreur: unknown) => {
          this.d.log.error({ err: erreur, module: m.id }, 'serveur de module relayé en échec');
        });
        return true;
      default:
        return false;
    }
  }

  private apres(modulesChanges: boolean, offreChangee: boolean): true {
    if (modulesChanges) this.d.diffusion.diffuser({ type: 'modules_modifies' });
    if (offreChangee) this.d.diffusion.diffuser({ type: 'duo_modifie' });
    return true;
  }
}
