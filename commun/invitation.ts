// Responsabilité : le texte d'invitation remis à un invité — `lanterne-invitation:` suivi du JSON UTF-8 en base64url
// sans remplissage (contrat partagé avec l'appli). Fonctions pures : encodage et lecture, refus explicites (texte trop
// long, version inconnue, champs manquants). Aucune E/S ; le code et la configuration VPN ne sont jamais journalisés.
import { z } from 'zod';

export const PREFIXE_INVITATION = 'lanterne-invitation:';
export const VERSION_INVITATION = 1;
export const TAILLE_MAX_INVITATION = 8000;

const VpnInvitation = z.strictObject({
  adresse: z.string().min(1).max(64),
  config: z.string().min(1).max(4000),
});

export const Invitation = z.strictObject({
  v: z.literal(VERSION_INVITATION),
  aiguilleur: z.string().url().max(300),
  code: z.string().min(1).max(40),
  expireLe: z.string().min(1).max(40),
  chef: z.string().min(1).max(80),
  vpn: VpnInvitation.nullable(),
});
export type Invitation = z.infer<typeof Invitation>;

export type ResultatInvitation<T> =
  | { readonly ok: true; readonly valeur: T }
  | { readonly ok: false; readonly raison: string };

function refus(raison: string): { readonly ok: false; readonly raison: string } {
  return { ok: false, raison };
}

export function encoderInvitation(invitation: Invitation): ResultatInvitation<string> {
  const valide = Invitation.safeParse(invitation);
  if (!valide.success) return refus('invitation incomplète ou non conforme');
  const texte = PREFIXE_INVITATION + Buffer.from(JSON.stringify(valide.data), 'utf8').toString('base64url');
  if (texte.length > TAILLE_MAX_INVITATION) return refus('invitation trop longue');
  return { ok: true, valeur: texte };
}

export function lireInvitation(brut: string): ResultatInvitation<Invitation> {
  const texte = brut.trim();
  if (texte.length > TAILLE_MAX_INVITATION) return refus('invitation trop longue');
  if (!texte.startsWith(PREFIXE_INVITATION)) return refus('ce n’est pas une invitation Lanterne');
  const corps = texte.slice(PREFIXE_INVITATION.length);
  if (!/^[A-Za-z0-9_-]+$/.test(corps)) return refus('invitation mal formée');
  const contenu = decoderJson(corps);
  if (contenu === undefined) return refus('invitation mal formée');
  if (typeof contenu === 'object' && contenu !== null && 'v' in contenu && contenu.v !== VERSION_INVITATION) {
    return refus(`version d’invitation inconnue : ${String(contenu.v)}`);
  }
  const lue = Invitation.safeParse(contenu);
  return lue.success ? { ok: true, valeur: lue.data } : refus('invitation incomplète ou non conforme');
}

function decoderJson(base64url: string): unknown {
  try {
    const texte: unknown = JSON.parse(Buffer.from(base64url, 'base64url').toString('utf8'));
    return texte;
  } catch {
    return undefined;
  }
}
