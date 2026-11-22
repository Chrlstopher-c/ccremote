// Responsabilité : une conversation Claude Code vue par plusieurs fiches (la fiche de poste — sdk, tmux ou terminal —
// et ses jumelles Remote Control `cse_…`) n'en garde qu'une entrée. La principale est la fiche de poste quand elle
// existe et n'est pas rangée ; sinon la vivante, puis la plus récente (même critère que l'aiguillage). Les autres sont
// masquées. Chaque activation de Remote Control dans Claude Desktop crée une jumelle neuve : l'ancienne reste,
// déconnectée. Une reprise (`--resume`) crée une fiche neuve pour la même conversation : même règle.
// Pur : aucune écriture ici.
import type { ResumeSession } from '../../commun/session.ts';

export interface PlanDoublons {
  /** Fiche masquée → fiche principale qui la remplace (même conversation). */
  readonly masquees: ReadonlyMap<string, string>;
}

/**
 * Conversation vue par une fiche : celle de sa jumelle Remote Control (`distant.conversation`), ou celle d'une fiche de
 * poste (`claudeSessionId`, ou son identifiant : même repli que l'appariement et l'aiguillage). Null si inconnue.
 */
export function conversationDe(s: ResumeSession): string | null {
  if (s.id.startsWith('cse_')) return s.distant?.conversation ?? null;
  return s.claudeSessionId ?? s.id;
}

/**
 * Fiche de poste (sdk, tmux ou terminal, hors Remote Control et hors copie du duo) : elle prime sur les jumelles de sa
 * conversation. Une copie du duo ne prime jamais : elle appartient au pair.
 */
export function estPoste(s: ResumeSession): boolean {
  return !s.id.startsWith('cse_') && s.duo === undefined;
}

/** Vivante : connectée à claude.ai et pas fermée. Même critère que `jumelleRemoteControl` (aiguillage). */
export function estVivante(s: ResumeSession): boolean {
  return s.distant?.connexion !== 'deconnectee' && s.statut !== 'fermee';
}

// Vrai si `a` passe avant `b` : vivante d'abord, puis la plus récente, puis l'identifiant (ordre stable).
function passeAvant(a: ResumeSession, b: ResumeSession): boolean {
  if (estVivante(a) !== estVivante(b)) return estVivante(a);
  if (a.majLe !== b.majLe) return a.majLe > b.majLe;
  return a.id < b.id;
}

/** Les fiches de chaque conversation, rangées comprises (`archivee` = drapeau du registre). */
function groupesParConversation(sessions: readonly ResumeSession[]): Map<string, ResumeSession[]> {
  const groupes = new Map<string, ResumeSession[]>();
  for (const s of sessions) {
    const conversation = conversationDe(s);
    if (conversation === null) continue;
    groupes.set(conversation, [...(groupes.get(conversation) ?? []), s]);
  }
  return groupes;
}

/** Principale d'un groupe : la fiche de poste non rangée, sinon la plus vivante ; null si tout est rangé. */
function principale(membres: readonly ResumeSession[]): ResumeSession | null {
  const candidates = membres.filter((s) => s.archivee !== true);
  if (candidates.length === 0) return null;
  const postes = candidates.filter(estPoste);
  const pool = postes.length > 0 ? postes : candidates;
  return pool.reduce((a, b) => (passeAvant(b, a) ? b : a));
}

export function planDoublons(sessions: readonly ResumeSession[]): PlanDoublons {
  const masquees = new Map<string, string>();
  for (const membres of groupesParConversation(sessions).values()) {
    if (membres.length < 2) continue;
    const tete = principale(membres);
    if (tete === null) continue;
    for (const m of membres) if (m.id !== tete.id) masquees.set(m.id, tete.id);
  }
  return { masquees };
}

/** Entrée visible qui représente `id` : sa principale si elle partage sa conversation, sinon `id` lui-même. */
export function cibleConversation(sessions: readonly ResumeSession[], id: string): string {
  return planDoublons(sessions).masquees.get(id) ?? id;
}

/** Toutes les fiches de la conversation de `id`, rangées comprises ; `[id]` si elle n'en partage aucune. */
export function membresConversation(sessions: readonly ResumeSession[], id: string): string[] {
  const fiche = sessions.find((s) => s.id === id);
  const conversation = fiche ? conversationDe(fiche) : null;
  if (conversation === null) return [id];
  return sessions.filter((s) => conversationDe(s) === conversation).map((s) => s.id);
}
