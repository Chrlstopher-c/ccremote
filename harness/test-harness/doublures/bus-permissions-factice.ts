// Doublure du bus de permissions. Table indexée par `requestId`, six états de C.2.1.
// `deduplication: false` reproduit la panne #25 pour prouver qu'un test la voit.

import type {
  BusPermissions,
  DemandePermission,
  EntreeDemande,
  EtatDemande,
  Verdict,
} from '../contrats/permissions.ts';
import type { Horloge } from '../contrats/horloge.ts';
import type { JournalPannes } from '../journal/journal-pannes.ts';

interface EtatInterne extends EntreeDemande {
  etat: EtatDemande;
  verdict: Verdict | null;
  recueA: number;
  repondueA: number | null;
  confirmeeA: number | null;
  bloqueeIndefiniment: boolean;
}

export interface OptionsBusPermissions {
  /** C.3.2. À `false`, chaque redélivrance renotifie l'humain. */
  readonly deduplication: boolean;
}

export const OPTIONS_BUS_SAINES: OptionsBusPermissions = { deduplication: true };

export class BusPermissionsFactice implements BusPermissions {
  #notifications = 0;
  readonly #demandes = new Map<string, EtatInterne>();

  constructor(
    private readonly horloge: Horloge,
    private readonly journal: JournalPannes,
    private options: OptionsBusPermissions = OPTIONS_BUS_SAINES,
  ) {}

  configurer(options: Partial<OptionsBusPermissions>): void {
    this.options = { ...this.options, ...options };
  }

  recevoir(entree: EntreeDemande): void {
    if (this.#demandes.has(entree.requestId)) {
      this.redelivrer(entree);
      return;
    }
    this.#demandes.set(entree.requestId, {
      ...entree,
      etat: 'en_attente',
      verdict: null,
      recueA: this.horloge.maintenant(),
      repondueA: null,
      confirmeeA: null,
      bloqueeIndefiniment: false,
    });
    this.journal.enregistrer('permission_recue', { requestId: entree.requestId });
    this.#notifier(entree.requestId);
  }

  redelivrer(entree: EntreeDemande): void {
    this.journal.enregistrer('permission_redelivree', { requestId: entree.requestId });
    const existante = this.#demandes.get(entree.requestId);
    if (existante === undefined) {
      this.recevoir(entree);
      return;
    }
    if (!this.options.deduplication) {
      this.#notifier(entree.requestId);
      return;
    }
    this.#traiterRedelivranceConnue(existante);
  }

  repondre(requestId: string, verdict: Verdict): void {
    const demande = this.#demandes.get(requestId);
    if (demande === undefined || demande.etat === 'caduque') return;
    demande.verdict = verdict;
    demande.etat = 'repondue';
    demande.repondueA = this.horloge.maintenant();
  }

  /**
   * Chemin hors-bande de C.2.3. `null` n'est légitime QUE si l'envoi du
   * `control_response` est confirmé. Sinon l'appel d'outil est bloqué à vie (#24).
   */
  repondreHorsBande(requestId: string, verdict: Verdict, envoiConfirme: boolean): null | Verdict {
    const demande = this.#demandes.get(requestId);
    if (demande === undefined) return verdict;
    if (!envoiConfirme) {
      demande.bloqueeIndefiniment = true;
      this.journal.enregistrer('null_sans_envoi_horsbande', { requestId });
      return null;
    }
    this.repondre(requestId, verdict);
    return null;
  }

  confirmer(requestId: string): void {
    const demande = this.#demandes.get(requestId);
    if (demande === undefined || demande.etat !== 'repondue') return;
    demande.etat = 'confirmee';
    demande.confirmeeA = this.horloge.maintenant();
  }

  rendreCaduque(requestId: string): void {
    const demande = this.#demandes.get(requestId);
    if (demande === undefined || demande.etat === 'confirmee') return;
    demande.etat = 'caduque';
    this.journal.enregistrer('permission_caduque', { requestId });
  }

  demande(requestId: string): DemandePermission | undefined {
    const interne = this.#demandes.get(requestId);
    return interne === undefined ? undefined : { ...interne };
  }

  enAttente(): readonly DemandePermission[] {
    return [...this.#demandes.values()]
      .filter((d) => d.etat === 'en_attente')
      .map((d) => ({ ...d }));
  }

  notificationsEmises(): number {
    return this.#notifications;
  }

  /** Invariant I-5 : `repondue` jamais `confirmee` au-delà du seuil ⇒ agent bloqué. */
  balayer(seuilMs: number): readonly string[] {
    const maintenant = this.horloge.maintenant();
    const bloquees: string[] = [];
    for (const demande of this.#demandes.values()) {
      const attend = demande.etat === 'repondue' && demande.repondueA !== null;
      if (!attend || maintenant - (demande.repondueA ?? 0) < seuilMs) continue;
      bloquees.push(demande.requestId);
      this.journal.enregistrer('alerte_agent_bloque', { requestId: demande.requestId });
    }
    return bloquees;
  }

  /** C.3.2 : connue ⇒ jamais de seconde notification humaine. */
  #traiterRedelivranceConnue(demande: EtatInterne): void {
    this.journal.enregistrer('permission_dedupliquee', {
      requestId: demande.requestId,
      etat: demande.etat,
    });
    if (demande.etat === 'repondue' || demande.etat === 'confirmee') {
      this.journal.enregistrer('verdict_reemis', { requestId: demande.requestId });
      return;
    }
    if (demande.etat === 'caduque') {
      this.journal.enregistrer('permission_caduque', { requestId: demande.requestId });
    }
  }

  #notifier(requestId: string): void {
    this.#notifications += 1;
    this.journal.enregistrer('notification_emise', { requestId });
  }
}
