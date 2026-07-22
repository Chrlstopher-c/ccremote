/**
 * Responsabilité : corréler une requête envoyée sur le lien Pi↔PC à sa
 * réponse arrivée plus tard, par `id`. Partagé par les deux sens de
 * multiplexage (`controle_requete`/`controle_reponse`, `permission_demande`/
 * `permission_verdict` — voir `protocole.ts`) : même besoin, même code,
 * jamais deux implémentations qui pourraient diverger silencieusement.
 *
 * `☠` Une requête en vol pendant une coupure transitoire ne reçoit PAS sa
 * réponse tant que le lien n'est pas rattaché — c'est `CanalDonnees` (D.2.2,
 * `transport/`) qui rejoue l'octet non acquitté après reconnexion, cette
 * classe n'a donc rien à faire d'autre qu'attendre : pas de retransmission
 * applicative en double ici, ce serait un second mécanisme de reprise.
 */

import { randomUUID } from 'node:crypto';

export class ErreurDelaiCorrelateur extends Error {
  constructor(id: string, timeoutMs: number) {
    super(`aucune réponse corrélée reçue pour « ${id} » dans le délai imparti (${String(timeoutMs)} ms)`);
    this.name = 'ErreurDelaiCorrelateur';
  }
}

export class CorrelateurReponses<TReponse> {
  readonly #enAttente = new Map<string, (reponse: TReponse) => void>();

  nouvelId(): string {
    return randomUUID();
  }

  /** Enregistre une attente et résout `timeoutMs` après, avec une erreur, si rien n'arrive. */
  attendre(id: string, timeoutMs: number): Promise<TReponse> {
    return new Promise((resolve, reject) => {
      const minuteur = setTimeout(() => {
        this.#enAttente.delete(id);
        reject(new ErreurDelaiCorrelateur(id, timeoutMs));
      }, timeoutMs);

      this.#enAttente.set(id, (reponse) => {
        clearTimeout(minuteur);
        this.#enAttente.delete(id);
        resolve(reponse);
      });
    });
  }

  /** Résout l'attente correspondante si elle existe encore. Silencieux sinon (réponse tardive après timeout). */
  resoudre(id: string, reponse: TReponse): void {
    this.#enAttente.get(id)?.(reponse);
  }

  enAttenteCount(): number {
    return this.#enAttente.size;
  }
}
