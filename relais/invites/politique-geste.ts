// Responsabilité : le verdict sur un geste relayé d'un pair (liste fermée, corps lu) — ce que l'invité peut faire sur
// sa session, son ouverture, et ce que les autres ne lisent pas. Le corps est relu ici, pas cru sur parole.
import type { CadreInvite } from '../../commun/cadre-invite.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import { effortApplique, gesteInvitePermis, type ReglagesInvite, type VerdictPart } from '../../commun/invites.ts';
import { EffortSession, type ResumeSession } from '../../commun/session.ts';
import type { GesteLocal } from '../federation/echanges.ts';
import { z } from 'zod';
import { corpsLu, type OuvertureInvite } from './ouverture.ts';
import { contenuPrive, inviteDe } from './sessions-invite.ts';

export type GesteRecu = Extract<MessageChiffre, { t: 'geste' }>;
export type VerdictGeste =
  | { readonly ok: true; readonly geste: GesteLocal }
  | { readonly ok: false; readonly statut: number; readonly raison: string };

export interface CtxGeste {
  readonly sessionDe: (id: string) => ResumeSession | null;
  readonly reglagesDe: (membre: string) => ReglagesInvite | null;
  readonly partDe: (membre: string, reglages: ReglagesInvite) => VerdictPart;
  readonly enCours: (membre: string) => number;
  readonly sessionsAutres: (membre: string) => boolean;
  readonly ouvrir: (membre: string, texte: string | undefined) => OuvertureInvite;
}

const refus = (statut: number, raison: string): VerdictGeste => ({ ok: false, statut, raison });
const ok = (m: GesteRecu, corps?: string, invite?: CadreInvite): VerdictGeste => ({
  ok: true,
  geste: {
    geste: m.geste,
    methode: m.methode,
    ...(m.session !== undefined ? { session: m.session } : {}),
    ...(m.machine !== undefined ? { machine: m.machine } : {}),
    ...(m.requete !== undefined ? { requete: m.requete } : {}),
    ...(corps !== undefined ? { corps } : {}),
    ...(invite !== undefined ? { invite } : {}),
  },
});

/** Le verdict d'un geste : d'abord l'invité (ses limites), sinon un pair ordinaire (contenu privé des invités). */
export function verdictGeste(ctx: CtxGeste, membre: string, m: GesteRecu): VerdictGeste {
  const reglages = ctx.reglagesDe(membre);
  if (reglages === null) return verdictPourAutres(ctx, m);
  if (m.geste === 'ouvrir') return ouvrir(ctx, membre, m);
  return gesteDeInvite(ctx, membre, reglages, m);
}

function verdictPourAutres(ctx: CtxGeste, m: GesteRecu): VerdictGeste {
  const cible = m.session !== undefined ? ctx.sessionDe(m.session) : null;
  return cible?.invite && contenuPrive(m.geste) ? refus(403, 'contenu privé') : ok(m, m.corps);
}

function ouvrir(ctx: CtxGeste, membre: string, m: GesteRecu): VerdictGeste {
  const r = ctx.ouvrir(membre, m.corps);
  return r.ok ? ok(m, JSON.stringify(r.corps), r.cadre) : refus(r.statut, r.raison);
}

function gesteDeInvite(ctx: CtxGeste, membre: string, reglages: ReglagesInvite, m: GesteRecu): VerdictGeste {
  if (m.machine !== undefined || m.session === undefined) return refus(403, 'portée non permise');
  const cible = ctx.sessionDe(m.session);
  if (cible === null) return refus(403, 'session inconnue');
  if (inviteDe(cible) !== membre) {
    const lecture = inviteDe(cible) === null && ctx.sessionsAutres(membre) && m.geste === 'evenements';
    return lecture && m.methode === 'GET' ? ok(m) : refus(403, 'session inconnue');
  }
  if (!gesteInvitePermis('session', m.geste, reglages.acces)) return refus(403, `geste non permis : ${m.geste}`);
  return verifierCorps(ctx, membre, reglages, cible, m);
}

/** Les gestes qui touchent au modèle, à l'effort ou au tour : relus et soumis aux limites. */
function verifierCorps(
  ctx: CtxGeste,
  membre: string,
  reglages: ReglagesInvite,
  cible: ResumeSession,
  m: GesteRecu,
): VerdictGeste {
  const corps = corpsLu(m.corps) ?? {};
  switch (m.geste) {
    case 'modele': {
      const modele = z.string().min(1).max(120).safeParse(corps['modele']);
      if (!modele.success) return refus(403, 'modèle absent');
      const permis = effortApplique(reglages, modele.data, null);
      return permis.ok ? ok(m) : refus(403, permis.raison);
    }
    case 'effort': {
      const effort = EffortSession.nullable().safeParse(corps['effort']);
      if (!effort.success) return refus(403, 'effort invalide');
      const permis = effortApplique(reglages, cible.modele, effort.data);
      return permis.ok ? ok(m) : refus(403, permis.raison);
    }
    case 'messages':
    case 'repondre':
      return partEtSimultanees(ctx, membre, reglages, m);
    default:
      return ok(m);
  }
}

function partEtSimultanees(ctx: CtxGeste, membre: string, reglages: ReglagesInvite, m: GesteRecu): VerdictGeste {
  const part = ctx.partDe(membre, reglages);
  if (!part.ok) return refus(403, part.raison);
  if (ctx.enCours(membre) >= reglages.simultanees) {
    return refus(403, `trop de sessions simultanées (max ${reglages.simultanees})`);
  }
  return ok(m);
}
