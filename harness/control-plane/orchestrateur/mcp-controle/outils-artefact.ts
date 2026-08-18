/**
 * Responsabilité : groupe « artefact » de la surface d'outils — l'orchestrateur
 * présente à Chris un contenu qu'il produit lui-même (script shell, Python,
 * Lua, ou page HTML) comme un bloc du fil, distinct d'une bulle de texte.
 *
 * `☠` Réutilise la racine et la route de lecture des pièces jointes
 * (`pieces-jointes/`, `ecrireArtefact`), jamais un second chemin d'octets —
 * décision de mandat. Diffère du chemin d'upload navigateur sur un seul point,
 * documenté dans `pieces-jointes/artefacts.ts` : pas de base64 à décoder, le
 * contenu est déjà du texte produit dans ce process.
 *
 * ☠ Aucune fonction ici ne laisse fuir d'exception (contrat A.2.4).
 */

import { ecrireArtefact, ErreurArtefact } from '../../pieces-jointes/index.ts';
import type { Registre } from '../../registre/index.ts';
import { applique, echecInattendu, refuse } from './contrat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import type { ContratRetour } from './types.ts';

const SANS_FIL = 'cette session n’est rattachée à aucune conversation : il n’y a nulle part où présenter cet artefact';
const RACINE_ABSENTE =
  'artefacts non configurés sur ce déploiement (CCREMOTE_PI_PIECES_JOINTES) — l’écrit-le en texte dans ta réponse';

export async function creerArtefact(
  registre: Registre,
  racinePiecesJointes: string | undefined,
  conversationId: string | null,
  nomFichier: string,
  contenu: string,
): Promise<ContratRetour> {
  const intention = `présenter l'artefact « ${nomFichier} »`;
  try {
    if (conversationId === null) return refuse(intention, SANS_FIL);
    if (racinePiecesJointes === undefined) return refuse(intention, RACINE_ABSENTE);
    const conv = registre.conversations.lire(conversationId);
    if (conv === null) return refuse(intention, SANS_FIL);

    const ecrit = await ecrireArtefact(racinePiecesJointes, conversationId, nomFichier, contenu);
    registre.conversations.ajouterEvenement({
      conversationId,
      type: 'artefact',
      contenu: ecrit.nom,
      pieces: [{ fichier: ecrit.fichier, nom: ecrit.nom, type: ecrit.type, taille: ecrit.taille }],
    });
    journal.info({ conversationId, fichier: ecrit.fichier, type: ecrit.type, taille: ecrit.taille }, 'artefact créé');
    return applique(
      intention,
      `artefact « ${ecrit.nom} » affiché dans le fil (${ecrit.type}, ${Math.max(1, Math.round(ecrit.taille / 1024))} Ko)`,
      ecrit.fichier,
    );
  } catch (erreur) {
    if (erreur instanceof ErreurArtefact) return refuse(intention, erreur.message);
    return echecInattendu(intention, erreur);
  }
}
