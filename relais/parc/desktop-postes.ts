// Responsabilité : les fiches Claude Desktop annoncées par les postes en ligne — une conversation peut tourner sur la
// tour et n'avoir sa fiche Desktop que sur le portable (Desktop en ssh). Le relais en tire, pour la fiche de la
// conversation quelle que soit sa machine : l'interrupteur Remote Control (réglage de Desktop) et l'archivage (une
// seule fois, voir archivages-desktop.ts). Pur hors mémoire des archivages.
import type { FicheDesktopAnnoncee } from '../../commun/decouverte.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { MemoireArchivages } from '../registre/archivages-desktop.ts';

export class DesktopDesPostes {
  private readonly parPoste = new Map<string, readonly FicheDesktopAnnoncee[]>();

  constructor(private readonly archivages: MemoireArchivages) {}

  recevoir(machine: string, fiches: readonly FicheDesktopAnnoncee[] | undefined): void {
    if (fiches) this.parPoste.set(machine, fiches);
  }

  oublier(machine: string): void {
    this.parPoste.delete(machine);
  }

  /** La fiche Desktop d'une conversation ; la plus « active » si plusieurs postes la connaissent. */
  fiche(conversation: string): FicheDesktopAnnoncee | null {
    const toutes = [...this.parPoste.values()].flat().filter((f) => f.conversation === conversation);
    return toutes.find((f) => f.remoteControl) ?? toutes.find((f) => !f.archivee) ?? toutes[0] ?? null;
  }

  /** `s` avec l'interrupteur Remote Control de sa fiche Desktop (session de poste seulement). */
  avecDesktop(s: ResumeSession): ResumeSession {
    if (s.distant) return s;
    const f = this.fiche(s.claudeSessionId ?? s.id);
    if (!f || s.remoteControl?.actif === f.remoteControl) return s;
    return { ...s, remoteControl: { actif: f.remoteControl, url: s.remoteControl?.url ?? null } };
  }

  /** Une conversation archivée dans Desktop, pas encore rangée par ce relais : à ranger maintenant (une fois). */
  aArchiver(conversation: string): boolean {
    const f = this.fiche(conversation);
    return f !== null && f.archivee && !f.remoteControl && !this.archivages.deja(conversation);
  }

  /** Rangement appliqué (ou demandé par le poste) : retenu pour ne jamais recommencer. */
  archivee(conversation: string): void {
    this.archivages.retenir(conversation);
  }

  dejaArchivee(conversation: string): boolean {
    return this.archivages.deja(conversation);
  }
}
