// Responsabilité : assembler, à partir de l'état du mode duo, le contexte des échanges et les échanges avancés (passer
// la main, modules, conflits, fil). Aucun état propre : chaque dépendance est fournie par le Duo qui l'appelle.
import { DUREE_DEMANDE_MS, type MessageLien } from '../../commun/duo.ts';
import type { MessageClient } from '../../commun/api-clients.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Registre } from '../registre/registre.ts';
import type { Attentes } from './attentes.ts';
import type { Contexte } from './contexte.ts';
import type { Demandes } from './demandes.ts';
import { EchangesAvances } from './echanges-avances.ts';
import type { DroitsDuo } from './droits.ts';
import type { JournalDuo } from './journal.ts';
import type { OptionsDuo } from './options-duo.ts';
import type { PartagesDuo } from './partages.ts';

export interface SocleDuo {
  readonly options: OptionsDuo;
  readonly registre: Registre;
  readonly diffusion: Diffusion;
  readonly horloge: () => number;
  readonly partages: PartagesDuo;
  readonly demandes: Demandes;
  readonly historique: JournalDuo;
  readonly droits: DroitsDuo;
  readonly attentes: Attentes;
  readonly nomLocal: () => string;
  readonly nomPair: () => string | null;
  readonly maintenant: () => string;
  readonly envoyer: (m: MessageLien) => boolean;
  readonly connecte: () => boolean;
  readonly partagerOuverte: (session: string) => void;
}

export function construireContexte(s: SocleDuo): Contexte {
  return {
    nomLocal: s.nomLocal,
    registre: s.registre,
    partages: s.partages,
    droits: s.droits,
    demandes: s.demandes,
    historique: s.historique,
    sessions: s.options.sessions,
    attentes: s.attentes,
    log: s.options.journal,
    delaiDemandeMs: s.options.delaiDemandeMs ?? DUREE_DEMANDE_MS,
    maintenant: s.maintenant,
    envoyer: s.envoyer,
    connecte: s.connecte,
    nomPair: () => s.nomPair() ?? 'le pair',
    partagerOuverte: s.partagerOuverte,
    fil: (session, evt) => {
      const evenement = s.registre.ajouterEvenement(session, s.maintenant(), evt);
      s.diffusion.diffuser({ type: 'evenement', evenement });
    },
    diffuser: (m: MessageClient) => s.diffusion.diffuser(m),
  };
}

export function creerAvances(s: SocleDuo, contexte: Contexte): EchangesAvances {
  return new EchangesAvances({
    base: s.options.base,
    registre: s.registre,
    postes: s.options.postes,
    diffusion: s.diffusion,
    partages: s.partages,
    demandes: s.demandes,
    historique: s.historique,
    droits: s.droits,
    attentes: s.attentes,
    contexte,
    horloge: s.horloge,
    envoyer: s.envoyer,
    maintenant: s.maintenant,
    nomLocal: s.nomLocal,
    nomPair: () => s.nomPair() ?? 'le pair',
    log: s.options.journal,
  });
}
