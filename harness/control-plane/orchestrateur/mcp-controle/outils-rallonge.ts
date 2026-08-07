/**
 * Responsabilité : groupe « rallonge » de la surface d'outils — l'orchestrateur
 * DEMANDE un relèvement de son plafond d'autonomie, il ne l'accorde jamais.
 *
 * `☠` C'est tout le sens du garde-fou (migration 26/27) : seul un clic humain,
 * via `POST /orchestrator/rallonges/:id/approve`, applique un nouveau plafond
 * au fil. Cette fonction écrit une DEMANDE en attente, rien de plus — jamais
 * `conversations.reglerPlafondAutonomie`.
 *
 * `☠` Borné à LA conversation appelante, même garde que `outils-fil.ts` :
 * `conversationId` vient de la closure du serveur, jamais d'un paramètre du
 * modèle.
 *
 * ☠ Aucune fonction ici ne laisse fuir d'exception (contrat A.2.4).
 */

import { randomUUID } from 'node:crypto';
import { normaliserReglagePlafond, ErreurPlafondInvalide, type ReglagePlafond } from '../../autonomie/index.ts';
import type { Registre } from '../../registre/index.ts';
import { applique, echecInattendu, refuse } from './contrat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import type { ContratRetour } from './types.ts';

const SANS_FIL = 'cette session n’est rattachée à aucune conversation : il n’y a aucun fil pour qui demander une rallonge';

type VerdictReglage = { readonly ok: true; readonly reglage: ReglagePlafond } | { readonly ok: false; readonly raison: string };

/**
 * Valide ce qui est demandé, AVANT toute écriture. `☠` Refuse aussi `herite` :
 * une rallonge demande forcément quelque chose, « hériter » n'en est pas une.
 */
function validerPlafondDemande(brut: string): VerdictReglage {
  try {
    const reglage = normaliserReglagePlafond(brut);
    if (reglage.type === 'herite') {
      return {
        ok: false,
        raison:
          'une rallonge doit porter un plafond précis (un entier positif ou « illimite ») — ' +
          '« herite » ne relève rien, il n’y a rien à demander.',
      };
    }
    return { ok: true, reglage };
  } catch (erreur) {
    if (erreur instanceof ErreurPlafondInvalide) return { ok: false, raison: erreur.message };
    throw erreur;
  }
}

export function demanderRallongeAutonomie(
  registre: Registre,
  conversationId: string | null,
  plafondDemande: string,
  motif: string,
  maintenant: number = Date.now(),
): ContratRetour {
  const intention = `demander une rallonge du plafond d'autonomie (« ${plafondDemande} »)`;
  try {
    if (conversationId === null) return refuse(intention, SANS_FIL);

    const verdict = validerPlafondDemande(plafondDemande);
    if (!verdict.ok) return refuse(intention, verdict.raison);

    // `☠` Une demande déjà en attente sur CE fil bloque la suivante : sans cette
    // garde, l'orchestrateur empilerait dix demandes pour le même besoin et
    // Chris trierait un doublon pour chaque clic utile.
    const dejaEnAttente = registre.rallonges.enAttente(conversationId);
    if (dejaEnAttente.length > 0) {
      return refuse(
        intention,
        `une demande attend déjà la décision de Chris sur ce fil (${dejaEnAttente[0]?.id}) — ` +
          'inutile d’en reposer une seconde, elle ne l’aiderait pas à décider plus vite.',
      );
    }

    const demande = registre.rallonges.creer(
      { id: randomUUID(), conversationId, plafondDemande: verdict.reglage, motif },
      maintenant,
    );
    journal.info({ conversationId, demandeId: demande.id, plafondDemande }, 'rallonge d’autonomie demandée');
    return applique(
      intention,
      'demande transmise à Chris — RIEN n’est accordé tant qu’il n’a pas cliqué : ton plafond ' +
        'actuel reste celui en vigueur, continue avec lui en attendant sa décision.',
      demande.id,
    );
  } catch (erreur) {
    journal.error({ err: erreur, conversationId, plafondDemande }, 'demanderRallongeAutonomie en échec');
    return echecInattendu(intention, erreur);
  }
}
