/**
 * Responsabilité : identité de session de l'orchestrateur maître (A.1.2,
 * acceptation (b)) — un `sessionId` FIXÉ par le harness, jamais auto-généré,
 * pour rester retrouvable après un redémarrage du Pi.
 *
 * Deux étapes distinctes, volontairement séparées :
 *  1. lire (ou créer une fois) l'UUID persisté — pur stockage, aucun contact SDK ;
 *  2. constater si le SDK connaît réellement une session sous cet UUID
 *     (`getSessionInfo`, port injectable) avant de choisir `resume` plutôt que
 *     de le supposer. Un fichier d'identité présent mais un process tué avant
 *     la première écriture SDK donnerait un `resume` sur une session fantôme —
 *     même philosophie que H-44 : mesurer, ne jamais deviner.
 */

import { randomUUID } from 'node:crypto';
import { processusOrchestrateurLogger as journal } from './logger.ts';

export type ModeDemarrage = 'demarrage_froid' | 'reprise';

export interface DecisionDemarrage {
  readonly sessionId: string;
  readonly mode: ModeDemarrage;
}

/** Port de stockage minimal — un seul UUID, lu ou créé une fois. Réel : `StockageIdentiteFichier`. */
export interface StockageIdentite {
  lire(): Promise<string | null> | string | null;
  ecrire(sessionId: string): Promise<void> | void;
}

/** Port vers `getSessionInfo` du SDK (01-verification-sdk.md, inventaire « Sessions »). */
export interface VerificateurSessionExistante {
  existe(sessionId: string): Promise<boolean>;
}

/**
 * Adaptateur fichier — un seul fichier JSON `{ sessionId }`. Pas de verrou : un
 * seul écrivain possible par construction (un boot lit-ou-crée une fois avant
 * que quoi que ce soit d'autre ne tourne).
 */
export class StockageIdentiteFichier implements StockageIdentite {
  constructor(private readonly chemin: string) {}

  async lire(): Promise<string | null> {
    try {
      const fichier = Bun.file(this.chemin);
      if (!(await fichier.exists())) return null;
      const contenu = (await fichier.json()) as { sessionId?: unknown };
      return typeof contenu.sessionId === 'string' ? contenu.sessionId : null;
    } catch (erreur) {
      journal.error({ err: erreur, chemin: this.chemin }, "identité orchestrateur illisible — traité comme absente");
      return null;
    }
  }

  async ecrire(sessionId: string): Promise<void> {
    try {
      await Bun.write(this.chemin, JSON.stringify({ sessionId }, null, 2));
    } catch (erreur) {
      journal.error({ err: erreur, chemin: this.chemin }, "échec d'écriture de l'identité orchestrateur sur disque");
      throw erreur;
    }
  }
}

/**
 * Résout (ou crée une seule fois) l'UUID fixé du harness, puis constate s'il
 * désigne une session déjà connue du SDK.
 *
 * `☠ CASSE` évité ici : sans l'appel à `verificateur.existe`, un `resume` sur un
 * identifiant jamais réellement écrit par le SDK échouerait au premier boot
 * réel plutôt qu'à la lecture de ce module — l'échec serait tardif et confus.
 */
export async function resoudreIdentite(
  stockage: StockageIdentite,
  verificateur: VerificateurSessionExistante,
): Promise<DecisionDemarrage> {
  const existant = await stockage.lire();
  if (existant === null) {
    const sessionId = randomUUID();
    await stockage.ecrire(sessionId);
    journal.info({ sessionId }, 'identité orchestrateur créée (premier démarrage)');
    return { sessionId, mode: 'demarrage_froid' };
  }

  const connue = await verificateur.existe(existant);
  if (!connue) {
    journal.warn(
      { sessionId: existant },
      "identité persistée mais SDK ne connaît aucune session sous cet id — démarrage froid sur le MÊME id (jamais un nouveau)",
    );
    return { sessionId: existant, mode: 'demarrage_froid' };
  }

  journal.info({ sessionId: existant }, 'session orchestrateur reprise après redémarrage');
  return { sessionId: existant, mode: 'reprise' };
}
