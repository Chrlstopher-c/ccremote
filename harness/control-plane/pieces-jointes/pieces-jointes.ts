/**
 * Responsabilité : accepter les pièces jointes d'un message opérateur, les
 * poser sur le disque du Pi, et rendre à l'orchestrateur le texte qui lui dit
 * où elles sont.
 *
 * `☠` L'ORCHESTRATEUR NE REÇOIT PAS L'IMAGE, IL REÇOIT UN CHEMIN. Mesuré le
 * 04/08 sur une session composée comme la sienne (`Read` seul, ni Bash ni
 * Write) : `Read` sur un PNG rend le contenu VISUEL du fichier — le modèle a
 * restitué mot pour mot le titre d'une capture. Passer l'image en bloc base64
 * dans le flux d'entrée aurait imposé de toucher au générateur d'entrée, au
 * schéma de persistance et au rejeu après compaction, pour le même résultat :
 * un fichier sur disque survit à la compaction et à la reprise de session,
 * un bloc image dans un contexte compacté, non.
 *
 * `☠` LE NOM DU FICHIER VIENT DU NAVIGATEUR — c'est une entrée non fiable qui
 * finit en chemin sur disque. Il est assaini ici, et l'extension est dérivée du
 * TYPE VALIDÉ, jamais du nom fourni : un `capture.png.sh` ne peut pas s'écrire
 * avec son extension d'origine.
 *
 * `☠` TOUT EST REFUSÉ AVANT LA PREMIÈRE ÉCRITURE (code-standards, « valider
 * avant le premier write ») : `validerPieces` est pure et rend la liste
 * complète des griefs. Un lot à moitié écrit suivi d'un refus laisserait des
 * fichiers orphelins et un message parti sans ses pièces.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Ce que le navigateur envoie. Aucun champ n'est digne de confiance avant validation. */
export interface PieceJointeEntrante {
  readonly nom: unknown;
  readonly type: unknown;
  readonly donneesBase64: unknown;
}

/** Une pièce validée, en mémoire, pas encore posée sur le disque. */
export interface PieceJointeValidee {
  readonly nom: string;
  readonly type: string;
  readonly octets: Uint8Array;
}

/** Une pièce posée sur le disque, telle qu'elle est persistée et affichée. */
export interface PieceJointeEnregistree {
  /** Nom du fichier réellement écrit — sert aussi d'identifiant dans l'URL de relecture. */
  readonly fichier: string;
  /** Nom d'origine, montré à l'opérateur. Jamais utilisé pour construire un chemin. */
  readonly nom: string;
  readonly type: string;
  readonly taille: number;
  readonly chemin: string;
}

export class ErreurPieceJointe extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurPieceJointe';
  }
}

export const MAX_PIECES_PAR_MESSAGE = 6;
export const MAX_OCTETS_PAR_PIECE = 10 * 1024 * 1024;
export const MAX_OCTETS_PAR_MESSAGE = 25 * 1024 * 1024;

/**
 * Types acceptés → extension écrite sur le disque.
 *
 * `☠` Tous sont lisibles par l'outil `Read` de l'orchestrateur : images, PDF,
 * texte. Accepter un type qu'il ne sait pas ouvrir lui ferait rendre « je ne
 * peux pas lire ce fichier » sur une pièce que l'écran montre pourtant comme
 * jointe — une capacité annoncée et absente, le mode de panne que ce dépôt
 * paie le plus cher.
 */
const TYPES_ACCEPTES = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
  ['text/plain', 'txt'],
  ['text/markdown', 'md'],
  ['text/csv', 'csv'],
  ['application/json', 'json'],
]);

/** Signatures vérifiées quand le format en a une — le type déclaré ne prouve rien. */
const SIGNATURES = new Map<string, readonly number[]>([
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],
  ['application/pdf', [0x25, 0x50, 0x44, 0x46]],
]);

export function typesAcceptes(): readonly string[] {
  return [...TYPES_ACCEPTES.keys()];
}

function refuser(message: string): never {
  // `☠` Le message nomme les valeurs acceptées : il est lu par un humain dans
  // l'interface, mais aussi, un jour, par un modèle qui doit pouvoir se corriger.
  throw new ErreurPieceJointe(message);
}

/** Ne garde que ce qui peut vivre dans un nom de fichier, sans jamais rendre vide. */
export function assainirNom(nom: string): string {
  const base = nom.split(/[/\\]/).pop() ?? nom;
  const propre = base
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 60);
  return propre.length === 0 ? 'piece' : propre;
}

function decoderBase64(brut: string, nom: string): Uint8Array {
  try {
    const nu = brut.includes(',') && brut.startsWith('data:') ? (brut.split(',')[1] ?? '') : brut;
    const octets = Uint8Array.from(Buffer.from(nu, 'base64'));
    if (octets.length === 0) refuser(`pièce « ${nom} » vide après décodage — le contenu base64 est invalide`);
    return octets;
  } catch (erreur) {
    if (erreur instanceof ErreurPieceJointe) throw erreur;
    return refuser(`pièce « ${nom} » : contenu base64 illisible`);
  }
}

function verifierSignature(type: string, octets: Uint8Array, nom: string): void {
  const attendue = SIGNATURES.get(type);
  if (attendue === undefined) return;
  const correspond = attendue.every((octet, i) => octets[i] === octet);
  if (!correspond) {
    refuser(
      `pièce « ${nom} » annoncée « ${type} » mais son contenu n'en a pas la signature — renommé ou corrompu`,
    );
  }
}

function validerUne(brute: PieceJointeEntrante, rang: number): PieceJointeValidee {
  const nom = typeof brute.nom === 'string' && brute.nom.trim().length > 0 ? brute.nom.trim() : `piece-${rang + 1}`;
  if (typeof brute.type !== 'string' || !TYPES_ACCEPTES.has(brute.type)) {
    refuser(
      `pièce « ${nom} » de type « ${String(brute.type)} » refusée — types acceptés : ${typesAcceptes().join(', ')}`,
    );
  }
  if (typeof brute.donneesBase64 !== 'string' || brute.donneesBase64.length === 0) {
    refuser(`pièce « ${nom} » sans contenu — attendu le fichier encodé en base64 dans « donneesBase64 »`);
  }
  const octets = decoderBase64(brute.donneesBase64, nom);
  if (octets.length > MAX_OCTETS_PAR_PIECE) {
    refuser(
      `pièce « ${nom} » de ${Math.round(octets.length / 1024)} Ko — plafond ` +
        `${MAX_OCTETS_PAR_PIECE / (1024 * 1024)} Mo par fichier`,
    );
  }
  verifierSignature(brute.type, octets, nom);
  return { nom, type: brute.type, octets };
}

/**
 * Valide un lot entier. Pure : aucune I/O, aucun effet — rien n'est écrit tant
 * que cette fonction n'a pas rendu la main sans lever.
 */
export function validerPieces(brutes: readonly PieceJointeEntrante[]): readonly PieceJointeValidee[] {
  if (brutes.length > MAX_PIECES_PAR_MESSAGE) {
    refuser(`${brutes.length} pièces jointes — plafond ${MAX_PIECES_PAR_MESSAGE} par message`);
  }
  const validees = brutes.map(validerUne);
  const total = validees.reduce((somme, p) => somme + p.octets.length, 0);
  if (total > MAX_OCTETS_PAR_MESSAGE) {
    refuser(
      `${Math.round(total / 1024)} Ko de pièces jointes — plafond ` +
        `${MAX_OCTETS_PAR_MESSAGE / (1024 * 1024)} Mo par message`,
    );
  }
  return validees;
}

/** Dossier d'une conversation. `☠` L'identifiant vient du client : il est assaini comme un nom. */
export function dossierConversation(racine: string, conversationId: string): string {
  return join(racine, assainirNom(conversationId));
}

/**
 * Écrit les pièces validées sous `racine/<conversation>/`. `☠` Le nom écrit est
 * `<horodatage>-<rang>-<nom assaini>.<ext du type validé>` : deux envois du même
 * fichier ne s'écrasent pas, et l'extension ne peut pas mentir sur le contenu.
 */
export async function ecrirePieces(
  racine: string,
  conversationId: string,
  validees: readonly PieceJointeValidee[],
  maintenant: number = Date.now(),
): Promise<readonly PieceJointeEnregistree[]> {
  if (validees.length === 0) return [];
  const dossier = dossierConversation(racine, conversationId);
  await mkdir(dossier, { recursive: true });
  const ecrites: PieceJointeEnregistree[] = [];
  for (const [rang, piece] of validees.entries()) {
    const extension = TYPES_ACCEPTES.get(piece.type) ?? 'bin';
    const base = assainirNom(piece.nom).replace(/\.[a-zA-Z0-9]{1,8}$/, '');
    const fichier = `${maintenant}-${rang}-${base}.${extension}`;
    const chemin = join(dossier, fichier);
    await writeFile(chemin, piece.octets);
    ecrites.push({ fichier, nom: piece.nom, type: piece.type, taille: piece.octets.length, chemin });
  }
  return ecrites;
}

/**
 * Chemin de relecture d'une pièce, pour la route qui la sert à l'interface.
 *
 * `☠` Le nom de fichier vient de l'URL : tout séparateur ou `..` est refusé ici,
 * jamais « nettoyé ». Nettoyer un chemin de traversée le rend valide et le laisse
 * passer ; le refuser laisse une trace et ne sert rien.
 */
export function cheminPieceRelue(racine: string, conversationId: string, fichier: string): string {
  if (/[/\\]/.test(fichier) || fichier.includes('..') || fichier.length === 0) {
    refuser(`nom de pièce « ${fichier} » invalide`);
  }
  if (/[/\\]/.test(conversationId) || conversationId.includes('..') || conversationId.length === 0) {
    refuser(`conversation « ${conversationId} » invalide`);
  }
  return join(dossierConversation(racine, conversationId), fichier);
}

function formaterTaille(octets: number): string {
  if (octets >= 1024 * 1024) return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
  return `${Math.max(1, Math.round(octets / 1024))} Ko`;
}

/**
 * Le bloc joint au message envoyé au SDK. `☠` Il DIT d'utiliser `Read` : sans
 * consigne, un chemin dans un message se lit comme une référence documentaire,
 * pas comme une invitation à ouvrir — et la pièce reste invisible au modèle
 * alors que l'interface la montre comme transmise.
 */
export function decrirePiecesPourModele(pieces: readonly PieceJointeEnregistree[]): string {
  if (pieces.length === 0) return '';
  const lignes = pieces.map((p) => `- ${p.nom} (${p.type}, ${formaterTaille(p.taille)}) → ${p.chemin}`);
  const accord = pieces.length > 1 ? 's' : '';
  return [
    `[pièce${accord} jointe${accord} à ce message — ${pieces.length} fichier${accord}]`,
    ...lignes,
    `Ouvre-${pieces.length > 1 ? 'les' : 'la'} avec l'outil Read AVANT de répondre : ` +
      'le contenu ne t\u2019est pas parvenu autrement.',
  ].join('\n');
}
