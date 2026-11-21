// Responsabilité : le fil d'activité du duo — les sessions partagées des deux côtés (qui tourne quoi, à quel niveau),
// les demandes en attente et les dernières lignes du journal.
import type { ActiviteDuo, EntreeActivite } from '../../commun/duo.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { Registre } from '../registre/registre.ts';
import type { Demandes } from './demandes.ts';
import type { JournalDuo } from './journal.ts';
import { niveauPour, type PartagesDuo } from './partages.ts';

const LIGNES_JOURNAL = 30;

export interface DependancesActivite {
  readonly registre: Registre;
  readonly partages: PartagesDuo;
  readonly demandes: Demandes;
  readonly journal: JournalDuo;
  readonly nomLocal: () => string;
}

export function activiteDuo(d: DependancesActivite): ActiviteDuo {
  const partages = d.partages.lister();
  const sessions = d.registre.sessions(false).flatMap((f) => entree(f, partages, d.nomLocal));
  return { sessions, demandes: d.demandes.lister(), journal: d.journal.lister(LIGNES_JOURNAL) };
}

// Une session du pair compte si elle nous est partagée ; une session locale, si nous la partageons.
function entree(
  f: ResumeSession,
  partages: ReturnType<PartagesDuo['lister']>,
  nomLocal: () => string,
): EntreeActivite[] {
  const base = { id: f.id, titre: f.titre, statut: f.statut, majLe: f.majLe };
  if (f.duo) return [{ ...base, qui: f.duo.nom ?? f.duo.pair, partagee: f.duo.niveau }];
  const niveau = niveauPour(f, partages);
  return niveau ? [{ ...base, qui: nomLocal(), partagee: niveau }] : [];
}
