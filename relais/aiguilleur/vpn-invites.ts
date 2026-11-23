// Responsabilité : la route `POST /api/membres/vpn-invites` de l'aiguilleur — un nœud (jeton de membre) obtient un
// accès VPN pour un invité : une paire de clés neuve, une adresse attribuée par le service root, la configuration à
// remettre. Seul un nœud demande ; cinq demandes en cours au plus par propriétaire ; la clé privée ne sort que dans la
// réponse HTTP.
import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import { type ReponseRootVpn, VPN_INVITES_MAX_PAR_PROPRIETAIRE } from '../../commun/aiguilleur.ts';
import type { ConfigVpnInvites } from '../config.ts';
import { erreur, json } from '../clients/http.ts';
import type { Annuaire, Membre } from './annuaire.ts';
import { membreDuJeton } from './api-codes.ts';
import { configWireguard, paireVpnNeuve } from './vpn-invites-cles.ts';
import { attendreReponse, deposerDemande, retirerFichiers } from './vpn-invites-depot.ts';

export interface OptionsVpnInvites {
  readonly annuaire: Annuaire;
  readonly journal: Logger;
  readonly config: ConfigVpnInvites | null;
  readonly delaiMs: number;
}

export function routeVpnInvites(options: OptionsVpnInvites): (req: Request) => Promise<Response> {
  const enCours = new Map<string, number>();
  return async (req) => {
    const membre = membreDuJeton(options.annuaire, req);
    if (!membre || membre.revoqueLe) {
      options.journal.warn('vpn : jeton absent, inconnu ou révoqué');
      return erreur('non connecté', 401);
    }
    if (membre.genre !== 'noeud') return erreur('seul un nœud demande un accès VPN', 403);
    const config = options.config;
    if (!config) return erreur('VPN des invités non configuré', 501);
    const nombre = enCours.get(membre.proprietaire) ?? 0;
    if (nombre >= VPN_INVITES_MAX_PAR_PROPRIETAIRE) {
      return erreur('trop de demandes VPN en cours : attends qu’une demande aboutisse', 429);
    }
    enCours.set(membre.proprietaire, nombre + 1);
    try {
      return await demander(options.journal, config, membre, options.delaiMs);
    } finally {
      retirerEnCours(enCours, membre.proprietaire);
    }
  };
}

function retirerEnCours(enCours: Map<string, number>, proprietaire: string): void {
  const nombre = (enCours.get(proprietaire) ?? 1) - 1;
  if (nombre > 0) enCours.set(proprietaire, nombre);
  else enCours.delete(proprietaire);
}

async function demander(
  journal: Logger,
  config: ConfigVpnInvites,
  membre: Membre,
  delaiMs: number,
): Promise<Response> {
  const id = randomBytes(8).toString('hex');
  const paire = paireVpnNeuve();
  try {
    deposerDemande(config.dossier, {
      id,
      cle: paire.publique,
      proprietaire: membre.proprietaire,
      le: new Date().toISOString(),
    });
    const reponse = await attendreReponse(config.dossier, id, delaiMs, journal);
    return rendreReponse(journal, config, membre, paire.privee, reponse);
  } catch (e) {
    journal.error({ err: e, membre: membre.id }, 'vpn : dépôt de la demande en échec');
    return erreur('demande VPN impossible, réessaie', 500);
  } finally {
    retirerFichiers(config.dossier, id, journal);
  }
}

function rendreReponse(
  journal: Logger,
  config: ConfigVpnInvites,
  membre: Membre,
  privee: string,
  reponse: ReponseRootVpn | null,
): Response {
  if (reponse === null) {
    journal.warn({ membre: membre.id }, 'vpn : le service root n’a pas répondu dans le délai');
    return erreur('le service VPN n’a pas répondu, réessaie', 504);
  }
  if (!reponse.ok) {
    journal.warn({ membre: membre.id, raison: reponse.raison }, 'vpn : demande refusée par le service root');
    return erreur(reponse.raison, 503);
  }
  journal.info({ membre: membre.id, proprietaire: membre.proprietaire }, 'vpn : accès attribué à une invitation');
  return json({
    adresse: reponse.adresse,
    config: configWireguard({
      adresse: reponse.adresse,
      privee,
      cleServeur: config.cleServeur,
      endpoint: config.endpoint,
      adresseAiguilleur: config.adresseAiguilleur,
    }),
  });
}
