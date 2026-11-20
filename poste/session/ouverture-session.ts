// Responsabilité : l'ouverture d'une nouvelle session demandée par Lanterne — compte et dossier vérifiés, fiche créée,
// réglages appliqués, premier message envoyé. Extrait du gestionnaire (gestionnaire.ts).
import { existsSync } from 'node:fs';
import type { DemandeSession } from '../../commun/session.ts';
import type { ConfigPoste } from '../config.ts';
import { composerConsignes } from './consignes.ts';
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

export async function ouvrirSession(g: DependancesOuverture, d: DemandeSession): Promise<Reponse> {
  if (g.sessions.has(d.sessionId)) return { ok: false, erreur: 'session déjà ouverte' };
  const compte = d.compte ?? Object.keys(g.config.comptes)[0] ?? 'principal';
  if (!(compte in g.config.comptes)) return { ok: false, erreur: `compte inconnu sur ${g.config.machine} : ${compte}` };
  const cwd = repertoireDe(g.config, d);
  if (!existsSync(cwd)) return { ok: false, erreur: `projet introuvable sur ${g.config.machine} : ${cwd}` };
  const configDir = g.config.comptes[compte] ?? null;
  const session = g.creer({
    resume: resumeInitial(g.config, d, cwd, compte),
    consignes: composerConsignes({
      machine: g.config.machine,
      cwd,
      demande: d,
      presentation: (d.moteur ?? 'sdk') === 'sdk',
    }),
    configDir,
    transcript: cheminTranscript(cwd, d.sessionId, configDir),
    position: 0,
    aReprendre: false,
  });
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
