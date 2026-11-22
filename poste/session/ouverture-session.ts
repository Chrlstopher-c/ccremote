// Responsabilité : l'ouverture d'une nouvelle session demandée par Lanterne — compte et dossier vérifiés, fiche créée,
// réglages appliqués, premier message envoyé. Extrait du gestionnaire (gestionnaire.ts). Une session d'invité part de
// son cadre (espace, configuration dédiée) et d'une demande ramenée à ce que ce cadre permet (cadre-invite.ts).
import { existsSync } from 'node:fs';
import type { DemandeSession } from '../../commun/session.ts';
import type { ConfigPoste } from '../config.ts';
import { composerConsignes } from './consignes.ts';
import { demandeInvite, refusOuvertureInvite } from './cadre-invite.ts';
import { repertoireDe, resumeInitial } from './fiche-initiale.ts';
import type { Reponse } from './gestionnaire.ts';
import type { SessionPersistee } from './persistance.ts';
import { reglagesDeOuverture } from './reglages-sdk.ts';
import type { SessionPoste } from './session-poste.ts';
import { cheminTranscript } from './transcript.ts';

export interface DependancesOuverture {
  readonly config: ConfigPoste;
  readonly sessions: Map<string, SessionPoste>;
  readonly creer: (p: SessionPersistee) => SessionPoste;
  readonly controle: (sessionId: string) => void; // Remote Control demandé à l'ouverture
}

function persistanceDeOuverture(
  g: DependancesOuverture,
  d: DemandeSession,
  cwd: string,
  compte: string,
): SessionPersistee {
  const compteConfig = g.config.comptes[compte] ?? null;
  const configDir = d.invite ? d.invite.config : compteConfig;
  return {
    resume: resumeInitial(g.config, d, cwd, compte),
    consignes: d.invite
      ? ''
      : composerConsignes({ machine: g.config.machine, cwd, demande: d, presentation: (d.moteur ?? 'sdk') === 'sdk' }),
    configDir,
    ...(d.invite ? { invite: { cadre: d.invite, configCompte: compteConfig } } : {}),
    transcript: cheminTranscript(cwd, d.sessionId, configDir),
    position: 0,
    aReprendre: false,
  };
}

export async function ouvrirSession(g: DependancesOuverture, demande: DemandeSession): Promise<Reponse> {
  if (g.sessions.has(demande.sessionId)) return { ok: false, erreur: 'session déjà ouverte' };
  const refus = refusOuvertureInvite(demande);
  if (refus) return { ok: false, erreur: refus };
  const d = demande.invite ? demandeInvite(demande) : demande;
  const compte = d.compte ?? Object.keys(g.config.comptes)[0] ?? 'principal';
  if (!(compte in g.config.comptes)) return { ok: false, erreur: `compte inconnu sur ${g.config.machine} : ${compte}` };
  const cwd = d.invite ? d.invite.espace : repertoireDe(g.config, d);
  if (!existsSync(cwd)) return { ok: false, erreur: `projet introuvable sur ${g.config.machine} : ${cwd}` };
  const session = g.creer(persistanceDeOuverture(g, d, cwd, compte));
  g.sessions.set(d.sessionId, session);
  if (d.controle_distant) g.controle(d.sessionId);
  const refusReglage = await reglagesDeOuverture(session, d);
  if (refusReglage) {
    g.sessions.delete(d.sessionId);
    return { ok: false, erreur: refusReglage };
  }
  const erreur = await session.lancer(d.message, d.modele ?? null, d.pieces ?? []);
  if (erreur) {
    g.sessions.delete(d.sessionId);
    return { ok: false, erreur };
  }
  return { ok: true, donnees: session.resume };
}
