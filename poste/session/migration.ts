// Responsabilité : migrer une session tenue hors Lanterne (Claude Desktop, terminal) vers Lanterne. La conversation est
// copiée (fork SDK, historique complet) en une session reprenable et pilotée par le poste ; la session d'origine n'est
// jamais écrite, elle reste à Chris (la fermer dans Desktop est son choix). Pas de reprise du même identifiant : deux
// processus écriraient le même transcript.
import { forkSession } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import { estMigrable } from '../../commun/migration.ts';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { Reponse } from './gestionnaire.ts';
import type { DependancesCopie } from './copie.ts';

// Ce que la migration touche du gestionnaire : ses sessions, l'import de la copie, le fil, la sauvegarde.
export interface DependancesMigration
  extends Pick<DependancesCopie, 'sessions' | 'trouverImportables' | 'importerUne' | 'sauvegarder' | 'fork'> {
  readonly journal: Logger;
  evenement(id: string, evt: Evenement): void;
}

type Copie = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly erreur: string };

/** Réglages repris de la session d'origine ; le reste (outils, MCP, réglages de Lanterne) est celui du poste. */
export function reglagesMigres(r: ResumeSession): Partial<ResumeSession> {
  return {
    titre: r.titre,
    modele: r.modele,
    effort: r.effort ?? null,
    mode: r.mode,
    pilotee: true,
  };
}

export async function migrer(d: DependancesMigration, id: string): Promise<Reponse> {
  const s = d.sessions.get(id);
  if (!s) return { ok: false, erreur: 'session inconnue sur ce poste' };
  if (!estMigrable(s.resume, null)) return { ok: false, erreur: 'session non migrable : Desktop ou terminal seulement' };
  const conversation = s.resume.claudeSessionId;
  if (!conversation) return { ok: false, erreur: 'conversation inconnue : rien à migrer' };
  const copie = await copierConversation(d, conversation, s.resume.cwd);
  if (!copie.ok) return copie;
  const importable = d.trouverImportables().find((t) => t.id === copie.id);
  if (!importable) return { ok: false, erreur: 'copie introuvable sur le poste : réessayer' };
  d.importerUne(importable, reglagesMigres(s.resume), null);
  d.evenement(id, { type: 'migration', sens: 'sortie', session: copie.id, titre: s.resume.titre });
  d.evenement(copie.id, { type: 'migration', sens: 'entree', session: id, titre: s.resume.titre });
  d.sauvegarder();
  return { ok: true, donnees: { nouvelleSession: copie.id } };
}

async function copierConversation(d: DependancesMigration, conversation: string, dir: string): Promise<Copie> {
  try {
    const r = await (d.fork ?? forkSession)(conversation, { dir });
    return { ok: true, id: r.sessionId };
  } catch (erreur) {
    d.journal.warn({ err: erreur, session: conversation }, 'migration refusée par le SDK');
    return { ok: false, erreur: `migration impossible : ${String(erreur)}` };
  }
}
