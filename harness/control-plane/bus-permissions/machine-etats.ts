/**
 * Responsabilité : machine à états des demandes de permission (branche C,
 * mission M-21). Périmètre strict : C.2.1 (six états), C.2.2 (invariants
 * I-1 à I-5), C.3.2 (idempotence de redélivrance), C.3.3 (rejet d'une
 * réponse). Ni le canal hors-bande (C.2.3, M-23) ni l'audit (C.5, M-22).
 *
 * D'où viennent réellement les demandes traitées ici (fait mesuré du
 * 2026-07-22) : en `permissionMode: 'auto'`, `canUseTool` n'est jamais
 * appelé — le classifieur du lead tranche seul, avant l'étage d'invite.
 * Cette machine ne reçoit donc PAS ses entrées de `canUseTool` en régime
 * nominal, mais du hook `PreToolUse` (C.1.1, C.5.3), seul point qui voit
 * l'exhaustivité des appels d'outils, y compris auto-résolus. Le chemin
 * `canUseTool` (mode `default`, ou exceptions de C.1.2) reste un second
 * producteur légitime, câblé par la mission qui pilote le worker (M-22) —
 * cette machine ne présuppose ni l'un ni l'autre comme unique source, elle
 * expose les deux entrées symétriquement (`recevoir` / `resoudreAuto` /
 * `escalader`).
 *
 * ☠ CASSE couverts par un test associé :
 *  - #25 (redélivrance non dédupliquée ⇒ doublon de notification)
 *  - I-2 (deuxième verdict sur une demande déjà répondue)
 *  - I-4 (verdict sur une demande caduque)
 *  - I-5 (répondue jamais confirmée ⇒ agent bloqué)
 */

import { busPermissionsLogger as journal } from './logger.ts';
import {
  HORLOGE_REELLE_BUS,
  type DemandePermission,
  type EntreeDemande,
  type EtatDemande,
  type HorlogeBus,
  type ResultatRedelivrance,
  type Verdict,
} from './types.ts';

interface EtatInterne extends EntreeDemande {
  etat: EtatDemande;
  verdict: Verdict | null;
  recueA: number;
  enAttenteDepuisA: number | null;
  repondueA: number | null;
  confirmeeA: number | null;
}

/** États depuis lesquels une demande peut encore être annulée (C.4.3). */
const ETATS_ANNULABLES: readonly EtatDemande[] = ['recue', 'en_attente', 'repondue'];

export class MachineEtatsDemandes {
  #notifications = 0;
  #reponsesDupliquees = 0;
  #verdictsSurCaduques = 0;
  readonly #demandes = new Map<string, EtatInterne>();
  readonly #horloge: HorlogeBus;

  constructor(horloge: HorlogeBus = HORLOGE_REELLE_BUS) {
    this.#horloge = horloge;
  }

  /**
   * Première arrivée d'une demande, avant tout arbitrage (C.2.1 : `[reçue]`).
   * Idempotent par `requestId` (I-3) : une arrivée déjà connue est traitée
   * comme une redélivrance, jamais comme une seconde création.
   */
  recevoir(entree: EntreeDemande): void {
    if (this.#demandes.has(entree.requestId)) {
      this.redelivrer(entree);
      return;
    }
    this.#demandes.set(entree.requestId, {
      ...entree,
      etat: 'recue',
      verdict: null,
      recueA: this.#horloge.maintenant(),
      enAttenteDepuisA: null,
      repondueA: null,
      confirmeeA: null,
    });
    this.#log('permission_recue', entree.requestId, { outil: entree.outil });
  }

  /**
   * Le lead a arbitré seul (`permissionMode: 'auto'`) sans escalader.
   * Terminal, silencieux : H-40/C.4.4 — pas de notification pour ce que le
   * lead a résolu seul, sinon la délégation ne sert à rien.
   */
  resoudreAuto(requestId: string, verdict: Verdict): boolean {
    const demande = this.#demandes.get(requestId);
    if (demande === undefined || demande.etat !== 'recue') {
      this.#log('transition_refusee', requestId, { cible: 'resolue_auto', etat: demande?.etat });
      return false;
    }
    demande.etat = 'resolue_auto';
    demande.verdict = verdict;
    this.#log('permission_resolue_auto', requestId, {});
    return true;
  }

  /**
   * Le lead n'a pas pu trancher seul : voie d'escalade (H-61 goulot humain).
   * Déclenche la seule notification humaine du cycle normal.
   */
  escalader(requestId: string): boolean {
    const demande = this.#demandes.get(requestId);
    if (demande === undefined || demande.etat !== 'recue') {
      this.#log('transition_refusee', requestId, { cible: 'en_attente', etat: demande?.etat });
      return false;
    }
    demande.etat = 'en_attente';
    demande.enAttenteDepuisA = this.#horloge.maintenant();
    this.#log('permission_escaladee', requestId, {});
    this.#notifier(requestId);
    return true;
  }

  /**
   * Redélivrance après coupure (C.3.1 : `reinitialize()` ou `initialize` avec
   * `pending_permission_requests`). Idempotente par `requestId` (C.3.2,
   * panne #25) : ne recrée jamais, ne renotifie jamais une demande déjà en
   * file ou déjà tranchée — elle réémet le verdict existant.
   */
  redelivrer(entree: EntreeDemande): ResultatRedelivrance {
    const existante = this.#demandes.get(entree.requestId);
    if (existante === undefined) {
      // Le harness a perdu sa mémoire (redémarrage du Pi) mais le SDK n'a
      // redélivré que ce qui avait déjà atteint l'étage d'invite (C.3.1) :
      // traiter comme une escalade fraîche, pas comme une première réception.
      this.#demandes.set(entree.requestId, {
        ...entree,
        etat: 'en_attente',
        verdict: null,
        recueA: this.#horloge.maintenant(),
        enAttenteDepuisA: this.#horloge.maintenant(),
        repondueA: null,
        confirmeeA: null,
      });
      this.#log('permission_redelivree', entree.requestId, { connue: false });
      this.#notifier(entree.requestId);
      return { action: 'nouvelle_escalade' };
    }
    this.#log('permission_dedupliquee', entree.requestId, { etat: existante.etat });
    return this.#traiterRedelivranceConnue(existante);
  }

  #traiterRedelivranceConnue(demande: EtatInterne): ResultatRedelivrance {
    if (demande.etat === 'en_attente') return { action: 'deja_en_file' };
    if (demande.etat === 'repondue' || demande.etat === 'confirmee') {
      this.#log('verdict_reemis', demande.requestId, { etat: demande.etat });
      // `verdict` est garanti non nul dans ces deux états par construction de `repondre`.
      return { action: 'verdict_a_reemettre', verdict: demande.verdict as Verdict };
    }
    if (demande.etat === 'caduque') {
      this.#log('permission_caduque_redelivree', demande.requestId, {});
      return { action: 'refusee' };
    }
    // 'recue' / 'resolue_auto' : jamais passées par l'étage d'invite, donc
    // jamais éligibles à une redélivrance SDK. Défensif — ne devrait pas survenir.
    this.#log('redelivrance_pre_escalade', demande.requestId, { etat: demande.etat });
    return { action: 'ignoree_pre_escalade' };
  }

  /**
   * Verdict sur la voie d'escalade. `en_attente` → `repondue`.
   * I-2 : un second verdict sur une demande déjà répondue/confirmée est un
   * défaut détecté et compté, jamais silencieusement appliqué.
   * I-4 : un verdict sur une demande caduque n'est jamais accepté.
   */
  repondre(requestId: string, verdict: Verdict): boolean {
    const demande = this.#demandes.get(requestId);
    if (demande === undefined) {
      this.#log('transition_refusee', requestId, { cible: 'repondue', etat: undefined });
      return false;
    }
    if (demande.etat === 'repondue' || demande.etat === 'confirmee') {
      this.#reponsesDupliquees += 1;
      this.#log('reponse_dupliquee', requestId, { etat: demande.etat });
      return false;
    }
    if (demande.etat === 'caduque') {
      this.#verdictsSurCaduques += 1;
      this.#log('verdict_sur_demande_caduque', requestId, {});
      return false;
    }
    if (demande.etat !== 'en_attente') {
      this.#log('transition_refusee', requestId, { cible: 'repondue', etat: demande.etat });
      return false;
    }
    demande.verdict = verdict;
    demande.etat = 'repondue';
    demande.repondueA = this.#horloge.maintenant();
    return true;
  }

  /**
   * C.3.3 — une réponse rejetée (malformée, forgée) ne transitionne rien :
   * la demande reste éligible à la redélivrance par `initialize`. Rejeter
   * n'est pas perdre.
   */
  rejeterReponse(requestId: string, motif: string): boolean {
    const demande = this.#demandes.get(requestId);
    if (demande === undefined || demande.etat !== 'en_attente') {
      this.#log('rejet_reponse_ignore', requestId, { motif, etat: demande?.etat });
      return false;
    }
    this.#log('reponse_rejetee', requestId, { motif });
    return true;
  }

  /** Le worker a repris : `repondue` → `confirmee`. Ferme l'écart de I-5. */
  confirmer(requestId: string): boolean {
    const demande = this.#demandes.get(requestId);
    if (demande === undefined || demande.etat !== 'repondue') {
      this.#log('transition_refusee', requestId, { cible: 'confirmee', etat: demande?.etat });
      return false;
    }
    demande.etat = 'confirmee';
    demande.confirmeeA = this.#horloge.maintenant();
    return true;
  }

  /**
   * Tour avorté / worker mort (C.4.3). Une demande `confirmee` résiste : le
   * worker a déjà repris, il est trop tard pour annuler quoi que ce soit.
   */
  rendreCaduque(requestId: string): boolean {
    const demande = this.#demandes.get(requestId);
    if (demande === undefined || !ETATS_ANNULABLES.includes(demande.etat)) return false;
    demande.etat = 'caduque';
    this.#log('permission_caduque', requestId, {});
    return true;
  }

  demande(requestId: string): DemandePermission | undefined {
    const interne = this.#demandes.get(requestId);
    return interne === undefined ? undefined : { ...interne };
  }

  enAttente(): readonly DemandePermission[] {
    return this.#parEtat('en_attente');
  }

  notificationsEmises(): number {
    return this.#notifications;
  }

  reponsesDupliquees(): number {
    return this.#reponsesDupliquees;
  }

  verdictsSurCaduques(): number {
    return this.#verdictsSurCaduques;
  }

  /**
   * I-1 — toute demande escaladée doit atteindre un état terminal. Une
   * demande `en_attente` depuis plus de `seuilMs` est un défaut à remonter :
   * ce n'est pas nécessairement un agent bloqué (voir I-5), mais une
   * escalade jamais traitée par l'humain.
   */
  balayerNonTraitees(seuilMs: number): readonly string[] {
    const maintenant = this.#horloge.maintenant();
    const alertes: string[] = [];
    for (const demande of this.#demandes.values()) {
      if (demande.etat !== 'en_attente' || demande.enAttenteDepuisA === null) continue;
      if (maintenant - demande.enAttenteDepuisA < seuilMs) continue;
      alertes.push(demande.requestId);
      this.#log('alerte_escalade_non_traitee', demande.requestId, {});
    }
    return alertes;
  }

  /**
   * I-5 — `[répondue]` sans `[confirmée]` au-delà du seuil : c'est **le**
   * symptôme d'agent bloqué. Un verdict est parti, le worker n'a jamais
   * donné signe de reprise.
   */
  balayerAgentBloque(seuilMs: number): readonly string[] {
    const maintenant = this.#horloge.maintenant();
    const bloquees: string[] = [];
    for (const demande of this.#demandes.values()) {
      if (demande.etat !== 'repondue' || demande.repondueA === null) continue;
      if (maintenant - demande.repondueA < seuilMs) continue;
      bloquees.push(demande.requestId);
      this.#log('alerte_agent_bloque', demande.requestId, {});
    }
    return bloquees;
  }

  #parEtat(etat: EtatDemande): readonly DemandePermission[] {
    const resultat: DemandePermission[] = [];
    for (const demande of this.#demandes.values()) {
      if (demande.etat === etat) resultat.push({ ...demande });
    }
    return resultat;
  }

  #notifier(requestId: string): void {
    this.#notifications += 1;
    this.#log('notification_emise', requestId, {});
  }

  #log(evenement: string, requestId: string, details: Record<string, unknown>): void {
    journal.debug({ evenement, requestId, ...details }, evenement);
  }
}
