// Responsabilité : copier la conversation d'une session du poste — duplication (le fil jusqu'à un message) et
// conversation annexe (copie complète, en lecture seule). La copie devient une session reprenable, importée du
// transcript, comme les sessions adoptées.
import { forkSession } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { CONSIGNE_ANNEXE, TITRE_ANNEXE } from './annexe.ts';
import type { Reponse } from './gestionnaire.ts';
import { transcriptHorsIndex, type TranscriptDecouvert } from './decouverte.ts';
import { cheminDansConfig, optionsMagasin } from './magasin-config.ts';
import type { SessionPersistee } from './persistance.ts';
import type { SessionPoste } from './session-poste.ts';

type Copie = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly erreur: string };

// Ce que la copie touche du gestionnaire : ses sessions, la liste des transcripts et leur import, la sauvegarde.
export interface DependancesCopie {
  readonly sessions: ReadonlyMap<string, SessionPoste>;
  readonly config: { readonly machine: string };
  readonly journal: Logger;
  trouverImportables(): TranscriptDecouvert[];
  importerUne(
    t: TranscriptDecouvert,
    surcharge: Partial<ResumeSession>,
    consignes: string | null,
    invite?: SessionPersistee['invite'],
  ): void;
  // Copie pas encore découverte : son parent sera posé à son import (ou tout de suite si sa fiche existe déjà).
  attendreParent(idCopie: string, idParent: string): void;
  sauvegarder(): void;
  readonly fork?: typeof forkSession; // injectable : les tests ne touchent pas au SDK
}

export async function dupliquer(d: DependancesCopie, id: string, messageId: string): Promise<Reponse> {
  const s = d.sessions.get(id);
  const conversation = s?.resume.claudeSessionId;
  if (!s || !conversation) return { ok: false, erreur: 'session inconnue ou sans conversation à dupliquer' };
  const r = await copier(d, s, { dir: s.resume.cwd, upToMessageId: messageId }, 'duplication');
  if (!r.ok) return r;
  const copie = copieTrouvee(d, s, r.id);
  if (copie) d.importerUne(copie, { parent: id, ...ficheInvite(s) }, null, s.persistee.invite);
  else d.attendreParent(r.id, id);
  d.sauvegarder();
  return { ok: true, donnees: { sessionId: r.id } };
}

// Annexe : copie complète, en SDK, sans permission à demander et sans outil d'écriture (voir annexe.ts).
export async function annexer(d: DependancesCopie, id: string): Promise<Reponse> {
  const s = d.sessions.get(id);
  const conversation = s?.resume.claudeSessionId;
  if (!s || !conversation) return { ok: false, erreur: 'session inconnue ou sans conversation à annoter' };
  if (s.resume.annexe_de) return { ok: false, erreur: 'une annexe n’a pas d’annexe' };
  const r = await copier(d, s, { dir: s.resume.cwd, title: TITRE_ANNEXE }, 'annexe');
  if (!r.ok) return r;
  const copie = copieTrouvee(d, s, r.id);
  if (!copie) return { ok: false, erreur: 'copie annexe introuvable sur le poste' };
  const reglages = {
    titre: TITRE_ANNEXE,
    moteur: 'sdk',
    pilotee: true,
    mode: 'bypassPermissions',
    annexe_de: id,
  } as const;
  // Une session d'invité ne lit que son cadre et son prompt : la consigne d'annexe passe par ce prompt.
  const invite = s.persistee.invite;
  const prompt = [s.resume.prompt_systeme ?? '', CONSIGNE_ANNEXE].filter((b) => b !== '').join('\n\n');
  if (invite) d.importerUne(copie, { ...reglages, ...ficheInvite(s), prompt_systeme: prompt }, null, invite);
  else d.importerUne(copie, reglages, CONSIGNE_ANNEXE);
  d.sauvegarder();
  return { ok: true, donnees: { id: r.id } };
}

// La fiche d'une copie de session d'invité reste celle d'un invité (mêmes membre et nom).
function ficheInvite(s: SessionPoste): Partial<ResumeSession> {
  return s.resume.invite ? { invite: s.resume.invite } : {};
}

// La copie est cherchée par la découverte ; une session d'invité l'écrit dans sa configuration, hors de l'index.
function copieTrouvee(d: DependancesCopie, s: SessionPoste, id: string): TranscriptDecouvert | undefined {
  const trouvee = d.trouverImportables().find((t) => t.id === id);
  const config = s.persistee.configDir;
  if (trouvee || !s.persistee.invite || !config) return trouvee;
  const chemin = cheminDansConfig(config, s.resume.cwd, id);
  return (chemin && transcriptHorsIndex(chemin, id, config, d.config.machine)) || undefined;
}

// Le transcript est lu et la copie écrite dans la configuration de la session (invité, autre compte).
async function copier(
  d: DependancesCopie,
  s: SessionPoste,
  options: { readonly dir: string; readonly upToMessageId?: string; readonly title?: string },
  libelle: string,
): Promise<Copie> {
  const conversation = s.resume.claudeSessionId ?? '';
  try {
    const r = await (d.fork ?? forkSession)(conversation, { ...options, ...optionsMagasin(s.persistee.configDir) });
    return { ok: true, id: r.sessionId };
  } catch (erreur) {
    d.journal.warn({ err: erreur }, `${libelle} refusée par le SDK`);
    return { ok: false, erreur: `${libelle} impossible : ${String(erreur)}` };
  }
}
