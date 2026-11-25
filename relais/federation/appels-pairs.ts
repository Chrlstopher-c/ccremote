// Responsabilité : relayer un appel de module aux nœuds de même propriétaire (« mes machines ») quand aucune appli
// de ce nœud ne peut le traiter. Le transport est le geste relayé entre nœuds (echanges.requeter) : sa liste fermée
// et la charte décident de ce qui passe. Le pair exécute l'appel avec ses applis seulement (route
// `modules/appel-pair`, jamais relayée à nouveau), et la première réponse réussie gagne. Un invité et un nœud d'un
// autre propriétaire n'y ont pas accès.
import type { Logger } from 'pino';
import { z } from 'zod';
import type { RequeteDroit } from '../../commun/charte.ts';
import { type MessageChiffre, TAILLE_MORCEAU_CARACTERES } from '../../commun/federation.ts';
import type { DemandeAppelModule } from '../../commun/modules.ts';
import { MODULE_ABSENT, type ResultatAppel, type RelaisPairs, sansAppliUtile } from '../modules/appels.ts';
import type { CanalNoeud } from './canal.ts';
import type { Echanges } from './echanges.ts';
import { decouper, nombreDeMorceaux } from './transferts.ts';

/** La route locale du pair qui exécute un appel relayé (liste fermée : commun/gestes-federes.ts). */
export const ROUTE_APPEL_PAIR = 'modules/appel-pair';

export function estAppelPair(requete: RequeteDroit): boolean {
  return requete.genre === 'geste' && requete.suffixe === ROUTE_APPEL_PAIR;
}

/** Un pair relayable : un de nos nœuds en ligne (même propriétaire), et pas un invité. */
export function estPairRelayable(
  membre: string,
  joignable: (id: string) => boolean,
  invite: (id: string) => boolean,
): boolean {
  return joignable(membre) && !invite(membre);
}

/** Droits d'un pair : la route d'appel exige un pair relayable ; ensuite la charte, comme pour tout geste. */
export function autoriserPair(
  membre: string,
  requete: RequeteDroit,
  relayable: (id: string) => boolean,
  charte: (id: string, requete: RequeteDroit) => boolean,
): boolean {
  if (estAppelPair(requete) && !relayable(membre)) return false;
  return charte(membre, requete);
}

export interface DependancesAppelsPairs {
  readonly pairs: () => readonly CanalNoeud[];
  readonly echanges: Pick<Echanges, 'requeter'>;
  readonly journal: Logger;
}

const ReponsePair = z.object({
  ok: z.boolean(),
  resultat: z.unknown().optional(),
  erreur: z.string().optional(),
});

function messagesAppel(ref: string, corps: string): MessageChiffre | readonly MessageChiffre[] {
  const requete: Extract<MessageChiffre, { t: 'geste' }> = {
    t: 'geste',
    ref,
    geste: ROUTE_APPEL_PAIR,
    methode: 'POST',
  };
  if (corps.length <= TAILLE_MORCEAU_CARACTERES) return { ...requete, corps };
  return [...decouper(ref, corps), { ...requete, morceaux: nombreDeMorceaux(corps) }];
}

// La réponse du pair : 200 `{ ok, resultat }` ou `{ ok: false, erreur }` ; tout autre contenu compte comme un échec.
function lireReponse(statut: number, corps: string): ResultatAppel {
  if (statut !== 200) return { ok: false, erreur: 'pair en échec' };
  try {
    const lue = ReponsePair.safeParse(JSON.parse(corps));
    if (lue.success && lue.data.ok) return { ok: true, resultat: lue.data.resultat ?? null };
    return { ok: false, erreur: lue.success ? (lue.data.erreur ?? 'échec chez le pair') : 'réponse illisible' };
  } catch {
    return { ok: false, erreur: 'réponse illisible' };
  }
}

export class AppelsPairs implements RelaisPairs {
  constructor(private readonly d: DependancesAppelsPairs) {}

  /** Demande l'appel à chaque pair relayable ; rend le premier résultat réussi, sinon le refus d'un pair qui a une
   *  appli (sa vraie raison : « navigateur fermé », référence absente…), sinon null. Avant le 25/11 ce refus était
   *  jeté et l'agent lisait « Lanterne n'est ouverte sur aucun appareil ». */
  relayer(demande: DemandeAppelModule, delaiMs: number): Promise<ResultatAppel | null> {
    const canaux = this.d.pairs();
    if (canaux.length === 0) return Promise.resolve(null);
    return new Promise((resoudre) => {
      let restants = canaux.length;
      let refus: ResultatAppel | null = null;
      for (const canal of canaux) {
        void this.interroger(canal, demande, delaiMs).then((r) => {
          if (r?.ok) {
            this.d.journal.info(
              { module: demande.module, outil: demande.outil, pair: canal.membre },
              'appel relayé : réussi',
            );
            return resoudre(r);
          }
          if (r && !r.ok && !sansAppliUtile(r, demande.module) && ![MODULE_ABSENT, 'pair en échec'].includes(r.erreur)) {
            refus = r;
          }
          restants -= 1;
          if (restants === 0) resoudre(refus);
        });
      }
    });
  }

  private async interroger(
    canal: CanalNoeud,
    demande: DemandeAppelModule,
    delaiMs: number,
  ): Promise<ResultatAppel | null> {
    const corps = JSON.stringify({
      module: demande.module,
      outil: demande.outil,
      arguments: demande.arguments ?? {},
      session: demande.session,
    });
    try {
      const reponse = await this.d.echanges.requeter(canal, (ref) => messagesAppel(ref, corps), delaiMs);
      if (!reponse || reponse.t !== 'geste_reponse') return null;
      return lireReponse(reponse.statut, reponse.corps);
    } catch (erreur) {
      this.d.journal.error({ err: erreur, pair: canal.membre }, 'appel relayé à un pair : échec');
      return null;
    }
  }
}
