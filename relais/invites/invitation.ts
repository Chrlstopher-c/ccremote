// Responsabilité : l'invitation tout-en-un d'un chef — un code à usage unique (même propriétaire), un accès VPN auprès
// de l'aiguilleur (absent si non configuré : l'invitation part sans VPN), et le texte à remettre à l'invité. Le code et
// la configuration ne sont journalisés nulle part ; la réponse ne porte que l'adresse VPN, la configuration reste dans
// le texte.
import { encoderInvitation, VERSION_INVITATION } from '../../commun/invitation.ts';
import type { CodesReseau } from '../codes-reseau/codes-reseau.ts';
import { echec, ok, type Resultat } from '../federation/resultat.ts';
import type { ReponseVpnInvite } from '../../commun/aiguilleur.ts';

export interface InvitationCreee {
  readonly invitation: string;
  readonly code: string;
  readonly expireLe: string;
  readonly vpn: { readonly adresse: string } | null;
}

type PortCodes = Pick<CodesReseau, 'configuration' | 'creer' | 'demanderVpn'>;

export async function creerInvitation(codes: PortCodes): Promise<Resultat<InvitationCreee>> {
  const config = codes.configuration();
  if (!config) return echec(409, 'nœud non relié à un aiguilleur');
  // Le code d'abord : s'il échoue, rien n'est créé côté VPN. Un code orphelin expire seul en 10 minutes.
  const code = await codes.creer({ genre: 'meme_proprietaire' });
  if (!code.ok) return code;
  const vpn = await accesVpn(codes);
  if (!vpn.ok) return vpn;
  const texte = encoderInvitation({
    v: VERSION_INVITATION,
    aiguilleur: config.url,
    code: code.valeur.code,
    expireLe: code.valeur.expireLe,
    chef: config.nom,
    vpn: vpn.valeur,
  });
  if (!texte.ok) return echec(500, texte.raison);
  return ok({
    invitation: texte.valeur,
    code: code.valeur.code,
    expireLe: code.valeur.expireLe,
    vpn: vpn.valeur === null ? null : { adresse: vpn.valeur.adresse },
  });
}

// 501 : VPN des invités non configuré chez l'aiguilleur, l'invitation part sans VPN ; tout autre échec la fait échouer.
async function accesVpn(codes: PortCodes): Promise<Resultat<ReponseVpnInvite | null>> {
  const r = await codes.demanderVpn();
  if (r.ok) return ok(r.valeur);
  return r.statut === 501 ? ok(null) : r;
}
