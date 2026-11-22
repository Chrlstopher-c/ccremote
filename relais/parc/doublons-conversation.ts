// Responsabilité : une conversation Claude Code vue par plusieurs fiches Remote Control (`cse_…`) n'en garde qu'une
// entrée. Chaque activation de Remote Control dans Claude Desktop crée une jumelle neuve : l'ancienne reste,
// déconnectée. Pur : la fiche principale est la vivante (même critère que l'aiguillage), sinon la plus récente ;
// les autres sont masquées.
import type { ResumeSession } from '../../commun/session.ts';

export interface PlanDoublons {
  /** Fiche masquée → fiche principale qui la remplace (même conversation). */
  readonly masquees: ReadonlyMap<string, string>;
}

/** Conversation d'une session Remote Control (`distant.conversation`) ; null pour toute autre fiche. */
export function conversationRc(s: ResumeSession): string | null {
  return s.id.startsWith('cse_') ? (s.distant?.conversation ?? null) : null;
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

/** Les fiches de chaque conversation Remote Control, archivées comprises (`archivee` = drapeau du registre). */
function groupesParConversation(sessions: readonly ResumeSession[]): Map<string, ResumeSession[]> {
  const groupes = new Map<string, ResumeSession[]>();
  for (const s of sessions) {
    const conversation = conversationRc(s);
    if (conversation === null) continue;
    groupes.set(conversation, [...(groupes.get(conversation) ?? []), s]);
  }
  return groupes;
}

/** La principale d'un groupe : la première des non archivées ; null si toutes sont rangées. */
function principale(membres: readonly ResumeSession[]): ResumeSession | null {
  const candidates = membres.filter((s) => s.archivee !== true);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (passeAvant(b, a) ? b : a));
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
