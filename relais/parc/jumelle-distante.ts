// Responsabilité : la session claude.ai (Remote Control) rattachée à la session de poste qui tient la même conversation
// reçoit la machine et le dossier réels de cette session, pour l'affichage. La machine propriétaire technique
// (`machine`) ne change pas : seul le relais décide de ce qui est affiché.
import type { Decouverte } from '../../commun/decouverte.ts';
import type { ResumeSession, StatutSession } from '../../commun/session.ts';
import { type ModeleDate, plusRecent } from '../../commun/modele-date.ts';

/** Le modèle daté d'une fiche (instant inconnu : null). */
export function modeleDatee(f: ResumeSession): ModeleDate {
  return { modele: f.modele, le: f.modeleLe ?? null };
}

/** `s` avec la conversation, la machine, le dossier et le modèle réels de sa jumelle de poste (`fiche`).
 * Le modèle de la fiche de poste l'emporte quand il est plus récent que celui de la session Remote Control. */
export function avecJumelleReelle(s: ResumeSession, fiche: ResumeSession | null): ResumeSession {
  if (!s.distant || !fiche) return s;
  const modele = plusRecent(modeleDatee(s), modeleDatee(fiche));
  return {
    ...s,
    modele: modele.modele,
    modeleLe: modele.le,
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

/** Statut d’une conversation vue par deux fiches (poste, Remote Control) : « travail » dès que l’autre travaille. */
export function statutDePaire(propre: StatutSession, autre: StatutSession | undefined): StatutSession {
  return propre === 'attente' && autre === 'travail' ? 'travail' : propre;
}
