// Doublure du lien Pi↔PC. Deux tuyaux, un état, une taxonomie de fermeture.
// Règle D.2.1 : le transitoire est absorbé en silence, seul le terminal remonte.

import type {
  CodeFermeture,
  EtatLien,
  FermetureTerminale,
  Lien,
  ModeIntegrite,
  Tuyau,
} from '../contrats/transport.ts';
import type { Horloge } from '../contrats/horloge.ts';
import type { JournalPannes } from '../journal/journal-pannes.ts';
import { TuyauOctets } from './tuyau-octets.ts';

const RAISONS: Readonly<Record<CodeFermeture, string>> = {
  401: 'credential expiré — se rattacher avec un secret frais',
  403: 'rejet HTTP permanent',
  404: 'rejet HTTP permanent',
  4090: 'epoch dépassé — plus le worker actif',
  4091: "échec d'initialisation du client",
  4092: 'fermeture sans code — cause inconnue',
};

/** 4090 interdit tout rattachement : le worker doit se terminer (D.2.1). */
const RATTACHEMENT_INTERDIT: readonly CodeFermeture[] = [4090];

export class LienFactice implements Lien {
  #etat: EtatLien = 'ouvert';
  #remonteesTransitoires = 0;
  #rattachements = 0;
  #abonnesFermeture: ((f: FermetureTerminale) => void)[] = [];
  readonly #versPc: TuyauOctets;
  readonly #versPi: TuyauOctets;

  constructor(
    private readonly horloge: Horloge,
    private readonly journal: JournalPannes,
    mode: ModeIntegrite = 'strict',
  ) {
    this.#versPc = new TuyauOctets({ nom: 'pi->pc', mode }, journal);
    this.#versPi = new TuyauOctets({ nom: 'pc->pi', mode }, journal);
  }

  etat(): EtatLien {
    return this.#etat;
  }

  versPc(): Tuyau {
    return this.#versPc;
  }

  versPi(): Tuyau {
    return this.#versPi;
  }

  surFermeture(abonne: (fermeture: FermetureTerminale) => void): void {
    this.#abonnesFermeture.push(abonne);
  }

  remonteesTransitoires(): number {
    return this.#remonteesTransitoires;
  }

  rattachements(): number {
    return this.#rattachements;
  }

  /**
   * Coupure passagère : les octets sont retenus, aucun `onClose` n'est émis,
   * le lien se rétablit tout seul après `dureeMs` d'horloge simulée.
   */
  couperTransitoire(dureeMs: number): void {
    if (this.#etat !== 'ouvert') return;
    this.#etat = 'coupe_transitoire';
    this.#versPc.suspendre();
    this.#versPi.suspendre();
    this.journal.enregistrer('lien_coupe_transitoire', { dureeMs });
    this.horloge.planifier(dureeMs, () => this.retablir());
  }

  retablir(): void {
    if (this.#etat !== 'coupe_transitoire') return;
    this.#etat = 'ouvert';
    this.#versPc.reprendre();
    this.#versPi.reprendre();
    this.journal.enregistrer('lien_retabli', {});
  }

  /** Fermeture définitive : c'est le seul cas qui appelle `onClose`. */
  couperTerminal(code: CodeFermeture): FermetureTerminale {
    this.#etat = 'ferme_terminal';
    const fermeture: FermetureTerminale = {
      terminal: true,
      code,
      raison: RAISONS[code],
      rattachementAutorise: !RATTACHEMENT_INTERDIT.includes(code),
    };
    this.journal.enregistrer('lien_ferme_terminal', { code, raison: fermeture.raison });
    for (const abonne of this.#abonnesFermeture) abonne(fermeture);
    return fermeture;
  }

  /**
   * Reproduit le défaut #28 : une coupure passagère remontée à l'appelant.
   * Sert à prouver qu'un test le détecte, jamais à être appelé en régime sain.
   */
  remonterTransitoire(): void {
    this.#remonteesTransitoires += 1;
    this.journal.enregistrer('remontee_transitoire_orchestrateur', {});
  }

  /**
   * Rattachement à froid (nouvel epoch) ou rafraîchissement de credential
   * (epoch conservé) — la distinction de D.2.3 est portée par l'appelant.
   */
  rattacher(): void {
    this.#etat = 'ouvert';
    this.#rattachements += 1;
    this.#versPc.reprendre();
    this.#versPi.reprendre();
  }
}
