// Responsabilité : les outils qui présentent un fichier — `envoyer_fichier` (copie d'un fichier du poste) et
// `publier_artefact` (page HTML, versionnée). Le contenu est copié dans le stockage de la session, jamais lu deux fois.
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import {
  nomAffiche,
  type ModeFichier,
  TAILLE_MAX_FICHIER,
  typeDeFichier,
  estIdArtefact,
} from '../../commun/presentation.ts';
import { echec, ok, protege, type ContexteOutils, type Resultat } from './outils.ts';
import { resoudreChemin } from './chemins.ts';
import { enregistrerVersion } from './artefacts.ts';
import { lireRegistre } from './registre.ts';

export interface ArgsEnvoi {
  readonly chemin: string;
  readonly legende?: string;
  readonly mode?: ModeFichier;
}

export function envoyerFichier(c: ContexteOutils, args: ArgsEnvoi): Resultat {
  return protege(c, 'envoi du fichier', () => {
    const trouve = resoudreChemin(args.chemin, c.cwd, c.racines);
    if (!trouve.ok) return echec(c, trouve.erreur);
    const nom = nomAffiche(basename(trouve.chemin));
    const mime = typeDeFichier(nom);
    if (!mime) return echec(c, `type de fichier non présentable : ${nom}`);
    const taille = statSync(trouve.chemin).size;
    if (taille > TAILLE_MAX_FICHIER) return echec(c, `fichier trop volumineux : ${nom} (5 Mo au plus)`);
    const id = c.stockage.nouvelId();
    c.stockage.ecrire(c.sessionId, id, readFileSync(trouve.chemin), { nom, mime, taille });
    const legende = args.legende?.trim() || null;
    c.emettre({ type: 'fichier', fichier: id, nom, mime, taille, mode: args.mode ?? 'afficher', legende });
    return ok(`Fichier présenté à Chris : ${nom}.`);
  });
}

export interface ArgsArtefact {
  readonly titre: string;
  readonly chemin?: string;
  readonly contenu?: string;
  readonly id?: string;
}

// Le contenu HTML : soit un fichier du poste (et son chemin absolu, source de l'artefact), soit le texte donné.
function contenuHtml(
  c: ContexteOutils,
  args: ArgsArtefact,
): { octets: Buffer; source: string | null } | { erreur: string } {
  if ((args.chemin === undefined) === (args.contenu === undefined))
    return { erreur: 'donner soit un chemin, soit un contenu' };
  if (args.contenu !== undefined) return verifierTaille(Buffer.from(args.contenu, 'utf8'), null);
  const trouve = resoudreChemin(args.chemin ?? '', c.cwd, c.racines);
  if (!trouve.ok) return { erreur: trouve.erreur };
  if (!/\.html?$/i.test(trouve.chemin)) return { erreur: 'un artefact est une page HTML (.html)' };
  return verifierTaille(readFileSync(trouve.chemin), trouve.chemin);
}

function verifierTaille(
  octets: Buffer,
  source: string | null,
): { octets: Buffer; source: string | null } | { erreur: string } {
  if (octets.length === 0) return { erreur: 'contenu vide' };
  if (octets.length > TAILLE_MAX_FICHIER) return { erreur: 'page trop volumineuse (5 Mo au plus)' };
  return { octets, source };
}

export function publierArtefact(c: ContexteOutils, args: ArgsArtefact): Resultat {
  return protege(c, 'publication de l’artefact', () => {
    const source = contenuHtml(c, args);
    if ('erreur' in source) return echec(c, source.erreur);
    if (args.id !== undefined && !estIdArtefact(args.id))
      return echec(c, `identifiant d’artefact invalide : ${args.id}`);
    const artefact = args.id ?? c.stockage.nouvelId();
    const precedentes = args.id === undefined ? 0 : c.stockage.versions(c.sessionId, artefact);
    if (args.id !== undefined && precedentes === 0) return echec(c, `artefact inconnu : ${args.id}`);
    const version = precedentes + 1;
    const fichier = `${artefact}-v${version}`;
    const titre = args.titre.trim();
    const nom = nomAffiche(`${titre.replace(/[\\/]/g, '-')}.html`);
    const taille = source.octets.length;
    const registre = lireRegistre(c.stockage, c.sessionId);
    c.stockage.ecrire(c.sessionId, fichier, source.octets, { nom, mime: 'text/html', taille });
    enregistrerVersion(c.stockage, c.sessionId, registre, {
      id: artefact,
      titre,
      version,
      fichier,
      source: source.source,
    });
    c.emettre({ type: 'artefact', artefact, version, fichier, titre, mime: 'text/html', taille });
    return ok(`Artefact publié : « ${titre} », version ${version}. Identifiant pour la mise à jour : ${artefact}.`);
  });
}
