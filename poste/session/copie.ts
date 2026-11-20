// Responsabilité : copier la conversation d'une session du poste — duplication (le fil jusqu'à un message) et
// conversation annexe (copie complète, en lecture seule). La copie devient une session reprenable, importée du
// transcript, comme les sessions adoptées.
import { forkSession } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { CONSIGNE_ANNEXE, TITRE_ANNEXE } from './annexe.ts';
import type { Reponse } from './gestionnaire.ts';
import type { TranscriptDecouvert } from './decouverte.ts';
import type { SessionPoste } from './session-poste.ts';

type Copie = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly erreur: string };

// Ce que la copie touche du gestionnaire : ses sessions, la liste des transcripts et leur import, la sauvegarde.
export interface DependancesCopie {
  readonly sessions: ReadonlyMap<string, SessionPoste>;
  readonly journal: Logger;
  trouverImportables(): TranscriptDecouvert[];
  importerUne(t: TranscriptDecouvert, surcharge: Partial<ResumeSession>, consignes: string | null): void;
  sauvegarder(): void;
  readonly fork?: typeof forkSession; // injectable : les tests ne touchent pas au SDK
}

export async function dupliquer(d: DependancesCopie, id: string, messageId: string): Promise<Reponse> {
  const s = d.sessions.get(id);
  const conversation = s?.resume.claudeSessionId;
  if (!s || !conversation) return { ok: false, erreur: 'session inconnue ou sans conversation à dupliquer' };
  const r = await copier(d, conversation, { dir: s.resume.cwd, upToMessageId: messageId }, 'duplication');
  if (!r.ok) return r;
  const copie = d.trouverImportables().find((t) => t.id === r.id);
  if (copie) d.importerUne(copie, { parent: id }, null);
  d.sauvegarder();
  return { ok: true, donnees: { sessionId: r.id } };
}

// Annexe : copie complète, en SDK, sans permission à demander et sans outil d'écriture (voir annexe.ts).
export async function annexer(d: DependancesCopie, id: string): Promise<Reponse> {
  const s = d.sessions.get(id);
  const conversation = s?.resume.claudeSessionId;
  if (!s || !conversation) return { ok: false, erreur: 'session inconnue ou sans conversation à annoter' };
  if (s.resume.annexe_de) return { ok: false, erreur: 'une annexe n’a pas d’annexe' };
  const r = await copier(d, conversation, { dir: s.resume.cwd, title: TITRE_ANNEXE }, 'annexe');
  if (!r.ok) return r;
  const copie = d.trouverImportables().find((t) => t.id === r.id);
  if (!copie) return { ok: false, erreur: 'copie annexe introuvable sur le poste' };
  d.importerUne(
    copie,
    { titre: TITRE_ANNEXE, moteur: 'sdk', pilotee: true, mode: 'bypassPermissions', annexe_de: id },
    CONSIGNE_ANNEXE,
  );
  d.sauvegarder();
  return { ok: true, donnees: { id: r.id } };
}

async function copier(
  d: DependancesCopie,
  conversation: string,
  options: { readonly dir: string; readonly upToMessageId?: string; readonly title?: string },
  libelle: string,
): Promise<Copie> {
  try {
    const r = await (d.fork ?? forkSession)(conversation, options);
    return { ok: true, id: r.sessionId };
  } catch (erreur) {
    d.journal.warn({ err: erreur }, `${libelle} refusée par le SDK`);
    return { ok: false, erreur: `${libelle} impossible : ${String(erreur)}` };
  }
}
