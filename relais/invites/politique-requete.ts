// Responsabilité : le verdict sur une requête d'un pair (fil, écriture, interruption, ouverture, terminal) — ce que
// l'invité peut demander, ce que les autres ne voient pas d'une session d'invité. Pur : l'appelant fournit l'état.
import type { MessageChiffre } from '../../commun/federation.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { ReglagesInvite, VerdictPart } from '../../commun/invites.ts';
import { reponseRefus } from './reponses.ts';
import { inviteDe } from './sessions-invite.ts';

export interface CtxRequete {
  readonly sessionDe: (id: string) => ResumeSession | null;
  readonly enCours: (membre: string) => number;
  readonly reglagesDe: (membre: string) => ReglagesInvite | null;
  readonly partDe: (membre: string, reglages: ReglagesInvite) => VerdictPart;
  readonly sessionsAutres: (membre: string) => boolean;
}

/** `invite` : la requête relève de la politique d'invité (la charte ne s'y applique pas) ; sinon la charte décide. */
export type VerdictRequete = { ok: true; invite: boolean } | { ok: false; reponse: MessageChiffre | null };

const CHARTE: VerdictRequete = { ok: true, invite: false };
const PASSE_INVITE: VerdictRequete = { ok: true, invite: true };

/** Le verdict d'une requête reçue d'un pair authentifié (identité du canal chiffré). */
export function verdictRequete(ctx: CtxRequete, membre: string, message: MessageChiffre): VerdictRequete {
  const reglages = ctx.reglagesDe(membre);
  if (reglages === null) return verdictPourAutres(ctx, message);
  return verdictInvite(ctx, membre, reglages, message);
}

/** Un pair qui n'est pas invité : il ne lit ni n'écrit une session d'invité ; il peut l'interrompre (charte). */
function verdictPourAutres(ctx: CtxRequete, message: MessageChiffre): VerdictRequete {
  if (message.t !== 'fil' && message.t !== 'ecrire') return CHARTE;
  if (inviteDe(ctx.sessionDe(message.session)) === null) return CHARTE;
  return { ok: false, reponse: reponseRefus(message.ref, 'contenu privé') };
}

function verdictInvite(
  ctx: CtxRequete,
  membre: string,
  reglages: ReglagesInvite,
  message: MessageChiffre,
): VerdictRequete {
  switch (message.t) {
    case 'fil':
      return verdictFil(ctx, membre, message.ref, message.session);
    case 'ecrire':
      return verdictEcriture(ctx, membre, reglages, message.ref, message.session);
    case 'interrompre':
      return propre(ctx, membre, message.ref, message.session);
    case 'ouvrir':
      return { ok: false, reponse: reponseRefus(message.ref, 'ouvrir par geste') };
    case 'geste':
      return PASSE_INVITE;
    default:
      return message.t.startsWith('terminal_') ? { ok: false, reponse: null } : CHARTE;
  }
}

/** Lire le fil : sa propre session, ou une session ordinaire si le chef l'autorise (lecture seule). */
function verdictFil(ctx: CtxRequete, membre: string, ref: string, session: string): VerdictRequete {
  const cible = ctx.sessionDe(session);
  if (cible === null) return { ok: false, reponse: reponseRefus(ref, 'session inconnue') };
  if (inviteDe(cible) === membre) return PASSE_INVITE;
  const autre = inviteDe(cible) === null && ctx.sessionsAutres(membre);
  return autre ? PASSE_INVITE : { ok: false, reponse: reponseRefus(ref, 'session inconnue') };
}

/** Écrire : sa propre session, part non atteinte, et moins de sessions en cours que permis. */
function verdictEcriture(
  ctx: CtxRequete,
  membre: string,
  reglages: ReglagesInvite,
  ref: string,
  session: string,
): VerdictRequete {
  const sienne = propre(ctx, membre, ref, session);
  if (!sienne.ok) return sienne;
  const part = ctx.partDe(membre, reglages);
  if (!part.ok) return { ok: false, reponse: reponseRefus(ref, part.raison) };
  if (ctx.enCours(membre) >= reglages.simultanees) {
    return { ok: false, reponse: reponseRefus(ref, `trop de sessions simultanées (max ${reglages.simultanees})`) };
  }
  return PASSE_INVITE;
}

function propre(ctx: CtxRequete, membre: string, ref: string, session: string): VerdictRequete {
  return inviteDe(ctx.sessionDe(session)) === membre
    ? PASSE_INVITE
    : { ok: false, reponse: reponseRefus(ref, 'session inconnue') };
}
