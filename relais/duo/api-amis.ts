// Responsabilité : les routes de la liste d'amis du mode duo — lister, ajouter, suspendre, retirer. Protégées comme les
// autres routes clients ; chaque changement diffuse `duo_modifie` (fait par AmisDuo).
import { type AmiDuo, CorpsSuspendre } from '../../commun/duo-amis.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { AmisDuo } from './amis.ts';
import type { Protection } from './api-duo.ts';
import type { Resultat } from './resultat.ts';

function rendreAmis(r: Resultat<AmiDuo[]>): Response {
  return r.ok ? json({ amis: r.valeur }) : erreur(r.raison, r.statut);
}

export function routesAmis(amis: AmisDuo, protege: Protection) {
  return {
    '/api/duo/amis': {
      GET: protege(() => json({ amis: amis.lister() })),
      POST: protege(() => {
        const r = amis.ajouter();
        if (!r.ok) return erreur(r.raison, r.statut);
        const ami = amis.decrire(r.valeur);
        return ami === null ? erreur('emplacement introuvable', 500) : json({ ami });
      }),
    },
    '/api/duo/amis/:ami/suspendre': {
      POST: protege(async (req) => {
        const c = await lireCorps(req, CorpsSuspendre);
        return c instanceof Response ? c : rendreAmis(amis.suspendre(req.params['ami'] ?? '', c.suspendu));
      }),
    },
    '/api/duo/amis/:ami/retirer': {
      POST: protege((req) => rendreAmis(amis.retirer(req.params['ami'] ?? ''))),
    },
  };
}
