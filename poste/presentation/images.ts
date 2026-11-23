// Responsabilité : les images des messages du SDK (résultats d'outils, lecture d'une image) — extraites des blocs,
// stockées par la session et présentées dans le fil. L'extraction est pure ; la présentation écrit et émet.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { TAILLE_MAX_FICHIER } from '../../commun/presentation.ts';
import type { ContexteOutils } from './outils.ts';

const TYPES_IMAGE_ACCEPTES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type TypeImage = (typeof TYPES_IMAGE_ACCEPTES)[number];

export function estTypeImage(mime: string): mime is TypeImage {
  return (TYPES_IMAGE_ACCEPTES as readonly string[]).includes(mime);
}

export interface ImageSdk {
  readonly mime: string;
  readonly base64: string;
  /** Nom du fichier d'origine (image citée par chemin) ; absent : « image-N ». */
  readonly nom?: string;
}

/** Le nom affiché d'une image : celui de son fichier s'il est connu, sinon « image-N.<ext> ». */
export function nomImage(image: ImageSdk, rang: number): string {
  return image.nom ?? `image-${rang + 1}.${image.mime.split('/')[1] ?? 'png'}`;
}

type Objet = Record<string, unknown>;

function estObjet(v: unknown): v is Objet {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function blocsDe(v: unknown): Objet[] {
  return Array.isArray(v) ? v.filter(estObjet) : [];
}

function imageDe(bloc: Objet): ImageSdk | null {
  const source = bloc['source'];
  if (bloc['type'] !== 'image' || !estObjet(source)) return null;
  if (source['type'] !== 'base64' || typeof source['data'] !== 'string') return null;
  const mime = source['media_type'];
  return typeof mime === 'string' ? { mime, base64: source['data'] } : null;
}

/** Les images d'un message utilisateur du SDK : blocs image directs ou dans un résultat d'outil. */
export function imagesDeMessage(msg: SDKMessage): ImageSdk[] {
  if (msg.type !== 'user') return [];
  return imagesDeContenu(msg.message.content);
}

/** Les images d'un contenu de message (SDK ou transcript) : blocs image directs ou dans un résultat d'outil. */
export function imagesDeContenu(contenu: unknown): ImageSdk[] {
  return blocsDe(contenu)
    .flatMap((bloc) => {
      if (bloc['type'] === 'tool_result') return blocsDe(bloc['content']).map(imageDe);
      return [imageDe(bloc)];
    })
    .filter((image): image is ImageSdk => image !== null && estTypeImage(image.mime));
}

/** Stocke chaque image et l'émet dans le fil. Une image trop lourde est écartée et journalisée, sans bloquer les autres. */
export function presenterImages(
  c: ContexteOutils,
  images: readonly ImageSdk[],
  origine: 'outil' | 'utilisateur',
  agent: string | undefined,
): void {
  images.forEach((image, rang) => {
    try {
      const octets = Buffer.from(image.base64, 'base64');
      if (octets.length > TAILLE_MAX_FICHIER) {
        c.journal.warn({ session: c.sessionId, taille: octets.length }, 'image trop lourde pour le fil, écartée');
        return;
      }
      const id = c.stockage.nouvelId();
      const nom = nomImage(image, rang);
      c.stockage.ecrire(c.sessionId, id, octets, { nom, mime: image.mime, taille: octets.length });
      c.emettre({
        type: 'image',
        fichier: id,
        nom,
        mime: image.mime,
        taille: octets.length,
        origine,
        ...(agent ? { agent } : {}),
      });
    } catch (erreur) {
      c.journal.error({ err: erreur, session: c.sessionId }, 'image du fil impossible à stocker');
    }
  });
}
