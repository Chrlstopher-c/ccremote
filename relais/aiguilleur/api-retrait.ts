// Responsabilité : le retrait d'un membre de l'annuaire, demandé par un nœud de même propriétaire (son chef l'a sorti
// de la charte) — le membre est révoqué : ses jetons tombent, son lien est coupé au balayage, il quitte la présence.
// Un appareil ne retire rien ; un nœud ne se retire pas lui-même. Aucun jeton n'est journalisé.
import type { Logger } from 'pino';
import { CorpsRetraitMembre } from '../../commun/aiguilleur.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import { type Annuaire, type Membre, empreinteSha256 } from './annuaire.ts';

export function routeRetraitMembre(annuaire: Annuaire, journal: Logger): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await retirer(annuaire, journal, req);
    } catch (e) {
      journal.error({ err: e }, 'retrait : erreur de l’annuaire');
      return erreur('retrait impossible, réessaie', 500);
    }
  };
}

async function retirer(annuaire: Annuaire, journal: Logger, req: Request): Promise<Response> {
  const auteur = membreDuJeton(annuaire, req);
  if (!auteur || auteur.revoqueLe) return erreur('non connecté', 401);
  if (auteur.genre !== 'noeud') return erreur('seul un nœud retire un membre', 403);
  const corps = await lireCorps(req, CorpsRetraitMembre);
  if (corps instanceof Response) return corps;
  if (corps.membre === auteur.id) return erreur('un nœud ne se retire pas lui-même', 400);
  const cible = annuaire.membre(corps.membre);
  if (!cible) return erreur('membre inconnu', 404);
  if (cible.proprietaire !== auteur.proprietaire) {
    journal.warn({ auteur: auteur.id, membre: cible.id }, 'retrait refusé : autre propriétaire');
    return erreur('membre d’un autre propriétaire', 403);
  }
  const retire = annuaire.revoquer(cible.id);
  journal.info({ auteur: auteur.id, membre: cible.id, deja: !retire }, 'membre retiré de l’annuaire');
  return json({ membre: cible.id, retire });
}

function membreDuJeton(annuaire: Annuaire, req: Request): Membre | null {
  const entete = req.headers.get('authorization') ?? '';
  const jeton = entete.startsWith('Bearer ') ? entete.slice(7) : '';
  return jeton ? annuaire.membreDuJeton(empreinteSha256(jeton)) : null;
}
