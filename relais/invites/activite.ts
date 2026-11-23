// Responsabilité : l'activité d'un invité vue par le chef (aujourd'hui, en cours, jetons, part des limites) — des
// nombres seulement, jamais de contenu. Calcul pur à partir des compteurs et des réglages.
import type { ActiviteInvite, BilanPartInvite, ReglagesInvite } from '../../commun/invites.ts';
import type { MembreCompteur } from './compteurs.ts';
import { consommeCourant, type Releve } from './part.ts';

export interface EntreeActivite {
  readonly reglages: ReglagesInvite;
  readonly compteurs: MembreCompteur;
  readonly enCours: number;
  readonly jour: string;
  readonly releves: Releve | null;
}

/** La date du jour, locale (AAAA-MM-JJ) : une journée commence à minuit chez le chef. */
export function jourLocal(maintenant: Date): string {
  return maintenant.toLocaleDateString('sv-SE');
}

function bilan(cle: string | null, consomme: number | null, part: number, reprise: string | null): BilanPartInvite {
  return { consomme: consomme ?? 0, part, reprise: reprise ?? cle };
}

/** L'activité d'un invité sur ce nœud (la télémétrie coupée est gérée par l'appelant : rien ne sort). */
export function activiteDe(e: EntreeActivite): ActiviteInvite {
  const jour = e.compteurs.jours[e.jour];
  const sessions = jour?.sessions ?? 0;
  const session = bilan(
    e.compteurs.session.cle,
    consommeCourant(e.compteurs.session, e.releves?.session),
    e.reglages.part5h,
    e.releves?.session?.reinitialiseLe ?? null,
  );
  const semaine =
    e.reglages.partSemaine === null
      ? null
      : bilan(
          e.compteurs.semaine.cle,
          consommeCourant(e.compteurs.semaine, e.releves?.semaine),
          e.reglages.partSemaine,
          e.releves?.semaine?.reinitialiseLe ?? null,
        );
  return {
    actifAujourdhui: sessions > 0 || (jour?.requetes ?? 0) > 0 || e.enCours > 0,
    derniere: jour?.derniere ?? null,
    sessionsAujourdhui: sessions,
    sessionsEnCours: e.enCours,
    jetonsAujourdhui: Math.round(jour?.jetons ?? 0),
    requetesAujourdhui: jour?.requetes ?? 0,
    dernierModele: jour?.modele ?? null,
    part5h: session,
    semaine,
  };
}
