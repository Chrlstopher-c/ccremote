// Responsabilité : la session claude.ai (Remote Control) rattachée à la session de poste qui tient la même conversation
// reçoit la machine et le dossier réels de cette session, pour l'affichage. La machine propriétaire technique
// (`machine`) ne change pas : seul le relais décide de ce qui est affiché.
import type { Decouverte } from '../../commun/decouverte.ts';
import type { ResumeSession } from '../../commun/session.ts';

/** `s` avec la conversation, la machine et le dossier réels de sa jumelle de poste (`fiche`), s'il y en a une. */
export function avecJumelleReelle(s: ResumeSession, fiche: ResumeSession | null): ResumeSession {
  if (!s.distant || !fiche) return s;
  return {
    ...s,
    distant: {
      ...s.distant,
      conversation: fiche.claudeSessionId ?? fiche.id,
      machineReelle: fiche.machine,
      cwdReel: fiche.cwd,
    },
  };
}

/** `s` rattachée à une conversation pas encore ouverte (découverte) qui la nomme dans ses ponts Remote Control. */
export function avecDecouverteJumelle(s: ResumeSession, d: Decouverte): ResumeSession {
  if (!s.distant) return s;
  return { ...s, distant: { ...s.distant, conversation: d.id, machineReelle: d.machine, cwdReel: d.cwd } };
}
