// Responsabilité : la création d'un code d'appairage par un nœud, avec son jeton de membre — un appareil de son
// propriétaire, ou une invitation en duo (un nouveau propriétaire, lié au sien). Un appareil ne crée rien ; cinq codes
// actifs au plus par propriétaire. Le code n'est jamais journalisé : seulement sa portée et son propriétaire.
import type { Logger } from 'pino';
import { CODES_ACTIFS_MAX_PAR_PROPRIETAIRE, CorpsCodeMembre } from '../../commun/aiguilleur.ts';
import { codeAppairageNeuf } from '../acces/appairage.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import { type Annuaire, type Membre, empreinteSha256 } from './annuaire.ts';

export function routeCodesMembre(annuaire: Annuaire, journal: Logger): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await creer(annuaire, journal, req);
    } catch (e) {
      journal.error({ err: e }, 'codes : erreur de l’annuaire');
      return erreur('code impossible à créer, réessaie', 500);
    }
  };
}

async function creer(annuaire: Annuaire, journal: Logger, req: Request): Promise<Response> {
  const auteur = membreDuJeton(annuaire, req);
  if (!auteur || auteur.revoqueLe) {
    journal.warn('code refusé : jeton absent, inconnu ou révoqué');
    return erreur('non connecté', 401);
  }
  if (auteur.genre !== 'noeud') {
    journal.warn({ membre: auteur.id }, 'code refusé : seul un nœud crée un code');
    return erreur('seul un nœud crée un code', 403);
  }
  const corps = await lireCorps(req, CorpsCodeMembre);
  if (corps instanceof Response) return corps;
  if (annuaire.compterCodesActifs(auteur.proprietaire) >= CODES_ACTIFS_MAX_PAR_PROPRIETAIRE) {
    journal.warn({ membre: auteur.id, proprietaire: auteur.proprietaire }, 'code refusé : limite de codes actifs');
    return erreur('trop de codes actifs : attends qu’un code soit utilisé ou expire', 429);
  }
  const code = codeAppairageNeuf();
  const nomInvite = corps.genre === 'invitation_duo' ? corps.nomInvite : null;
  annuaire.creerCodeAppairage(auteur.proprietaire, code.empreinte, code.expireLe, corps.genre, nomInvite);
  journal.info({ membre: auteur.id, proprietaire: auteur.proprietaire, portee: corps.genre }, 'code d’appairage créé');
  return json({ code: code.code, expireLe: code.expireLe });
}

export function membreDuJeton(annuaire: Annuaire, req: Request): Membre | null {
  const entete = req.headers.get('authorization') ?? '';
  const jeton = entete.startsWith('Bearer ') ? entete.slice(7) : '';
  return jeton ? annuaire.membreDuJeton(empreinteSha256(jeton)) : null;
}
