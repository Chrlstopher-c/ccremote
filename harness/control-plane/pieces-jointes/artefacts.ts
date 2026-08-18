/**
 * Responsabilité : écrire un artefact — un script ou une page HTML que
 * l'orchestrateur produit lui-même pour Chris — sur le MÊME disque et sous la
 * MÊME racine que les pièces jointes du navigateur (`pieces-jointes.ts`), pour
 * qu'il se serve ensuite par la MÊME route de lecture (`cheminPieceRelue`,
 * `servirPieceJointe`) et s'affiche dans le fil comme n'importe quelle pièce.
 *
 * `☠` NE PASSE PAS par `validerPieces`/`ecrirePieces` : ce pipeline attend un
 * blob base64 et vérifie sa signature binaire parce que le nom et le type
 * viennent d'un NAVIGATEUR non fiable (voir l'en-tête de `pieces-jointes.ts`).
 * Un artefact est produit par le modèle DANS CE PROCESS : son contenu est déjà
 * du texte en clair, et il n'existe pas de signature magique à vérifier sur un
 * script — le réencoder en base64 pour le décoder aussitôt après n'aurait
 * ajouté aucune garantie, seulement de la cérémonie.
 *
 * Ce qui EST réutilisé, à l'identique : `assainirNom` (même traversée de
 * chemin refusée), `dossierConversation` (même racine, même arborescence par
 * fil). Un artefact et une pièce jointe sont indiscernables une fois posés sur
 * le disque — la route de lecture ne sait pas laquelle elle sert.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assainirNom, dossierConversation } from './pieces-jointes.ts';

export class ErreurArtefact extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurArtefact';
  }
}

/** Largement au-dessus d'un script ou d'une page HTML — un artefact reste du texte. */
export const MAX_OCTETS_ARTEFACT = 2 * 1024 * 1024;

/**
 * Extension déclarée par le modèle → type MIME servi à l'écran. Liste FERMÉE,
 * bornée au périmètre du mandat (« un script shell, Python ou Lua, une page
 * HTML ») — l'élargir à d'autres langages est un ajout d'une ligne ici.
 */
const TYPES_ARTEFACT = new Map<string, string>([
  ['html', 'text/html'],
  ['sh', 'text/x-sh'],
  ['py', 'text/x-python'],
  ['lua', 'text/x-lua'],
]);

export function typesArtefactAcceptes(): readonly string[] {
  return [...TYPES_ARTEFACT.keys()];
}

function extensionDe(nom: string): string {
  const correspond = /\.([a-zA-Z0-9]+)$/.exec(nom);
  return correspond?.[1]?.toLowerCase() ?? '';
}

/** Un artefact posé sur le disque — même forme que `PieceJointeEnregistree`. */
export interface ArtefactEcrit {
  readonly fichier: string;
  readonly nom: string;
  readonly type: string;
  readonly taille: number;
  readonly chemin: string;
}

/**
 * Écrit un artefact sous `racine/<conversation>/`. `☠` Refusé AVANT toute
 * écriture (extension inconnue, contenu vide ou trop gros) : même discipline
 * que `validerPieces` — un refus ne doit jamais laisser un fichier à moitié
 * écrit derrière lui.
 */
export async function ecrireArtefact(
  racine: string,
  conversationId: string,
  nomFichier: string,
  contenu: string,
  maintenant: number = Date.now(),
): Promise<ArtefactEcrit> {
  const nom = nomFichier.trim();
  const extension = extensionDe(nom);
  const type = TYPES_ARTEFACT.get(extension);
  if (type === undefined) {
    throw new ErreurArtefact(
      `artefact « ${nom || nomFichier} » refusé — extension attendue parmi : ` +
        typesArtefactAcceptes()
          .map((e) => `.${e}`)
          .join(', '),
    );
  }
  const octets = new TextEncoder().encode(contenu);
  if (octets.length === 0) refuserArtefactVide(nom);
  if (octets.length > MAX_OCTETS_ARTEFACT) {
    throw new ErreurArtefact(
      `artefact « ${nom} » de ${Math.round(octets.length / 1024)} Ko — plafond ` +
        `${MAX_OCTETS_ARTEFACT / (1024 * 1024)} Mo`,
    );
  }
  const dossier = dossierConversation(racine, conversationId);
  await mkdir(dossier, { recursive: true });
  const base = assainirNom(nom).replace(/\.[a-zA-Z0-9]{1,8}$/, '');
  const fichier = `${maintenant}-${base}.${extension}`;
  const chemin = join(dossier, fichier);
  await writeFile(chemin, octets);
  return { fichier, nom, type, taille: octets.length, chemin };
}

function refuserArtefactVide(nom: string): never {
  throw new ErreurArtefact(`artefact « ${nom} » : contenu vide`);
}
