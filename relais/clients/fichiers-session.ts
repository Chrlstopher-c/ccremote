// Responsabilité : la réponse d'un fichier présenté par une session (sortie d'outil, image du fil, pièce jointe). Le
// contenu vient du poste ; les en-têtes le rendent sans risque : HTML et SVG sous CSP `sandbox` (aucun script dans
// l'origine de Quart), type déclaré et jamais deviné, téléchargement seulement sur demande.
import type { FichierLu } from '../../commun/presentation.ts';

const TYPES_SANDBOX: ReadonlySet<string> = new Set(['text/html', 'image/svg+xml']);

function typeEnTete(mime: string): string {
  const texte = mime.startsWith('text/') || mime === 'application/json';
  return texte ? `${mime}; charset=utf-8` : mime;
}

export function reponseFichier(f: FichierLu, telecharger: boolean): Response {
  const entetes: Record<string, string> = {
    'content-type': typeEnTete(f.mime),
    'content-disposition': `${telecharger ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.nom)}`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=300',
  };
  if (TYPES_SANDBOX.has(f.mime)) entetes['content-security-policy'] = 'sandbox';
  return new Response(Buffer.from(f.base64, 'base64'), { headers: entetes });
}
