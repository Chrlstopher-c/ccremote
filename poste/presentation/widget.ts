// Responsabilité : `afficher_widget` — un SVG ou un fragment HTML court, rendu en place dans le fil. Stocké comme les
// autres fichiers de la session ; le rendu est fait par l'interface, dans un cadre isolé.
import type { ContexteOutils, Resultat } from './outils.ts';
import { echec, ok, protege } from './outils.ts';
import { nomAffiche, TAILLE_MAX_WIDGET } from '../../commun/presentation.ts';

export interface ArgsWidget {
  readonly titre: string;
  readonly code: string;
  readonly type: 'svg' | 'html';
}

const DEBUT_SVG = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i;

export function afficherWidget(c: ContexteOutils, args: ArgsWidget): Resultat {
  return protege(c, 'affichage du widget', () => {
    const code = args.code.trim();
    if (!code) return echec(c, 'widget vide');
    const octets = Buffer.from(code, 'utf8');
    if (octets.length > TAILLE_MAX_WIDGET) return echec(c, 'widget trop volumineux (300 Ko au plus)');
    if (args.type === 'svg' && !DEBUT_SVG.test(code)) return echec(c, 'SVG attendu : la balise <svg> est absente');
    const titre = args.titre.trim();
    const mime = args.type === 'svg' ? 'image/svg+xml' : 'text/html';
    const id = c.stockage.nouvelId();
    const nom = nomAffiche(`${titre.replace(/[\\/]/g, '-')}.${args.type}`);
    c.stockage.ecrire(c.sessionId, id, octets, { nom, mime, taille: octets.length });
    c.emettre({ type: 'widget', fichier: id, titre, mime, taille: octets.length });
    return ok(`Widget affiché : « ${titre} ».`);
  });
}
