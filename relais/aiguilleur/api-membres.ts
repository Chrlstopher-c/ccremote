// Responsabilité : l'appairage d'un membre (nœud ou appareil) — il présente le code d'une commande locale, sa clé
// publique et son genre ; il reçoit un identifiant, un jeton et le propriétaire du code. Même limite de tentatives
// que la connexion : par adresse (5 échecs en 15 min) et globale (plafond partagé du relais).
import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import { z } from 'zod';
import { GENRES_MEMBRE } from '../../commun/aiguilleur.ts';
import { empreinteCode } from '../acces/appairage.ts';
import type { PlafondEchecs } from '../acces/plafond.ts';
import { ipDe } from '../clients/api.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import { type Annuaire, type CodeConsomme, empreinteSha256 } from './annuaire.ts';
import { proprietaireInvite } from './proprietaire-invite.ts';

export const CHEMIN_APPAIRAGE = '/api/membres/appairer';

const MAX_ECHECS_ADRESSE = 5;
const FENETRE_ECHECS_MS = 15 * 60 * 1000;
// Clé publique opaque : base64url de 32 à 128 caractères (le chiffrement réel relève de la couche chiffrement).
const VALIDE_CLE = /^[A-Za-z0-9_-]{32,128}$/;

const CorpsAppairage = z.object({
  code: z.string().trim().min(1).max(40),
  nom: z.string().trim().min(1).max(80),
  genre: z.enum(GENRES_MEMBRE),
  cle: z.string().regex(VALIDE_CLE),
});

export interface Serveur {
  requestIP(req: Request): { readonly address: string } | null;
}

/** Échecs récents par adresse : au-delà de la limite, plus aucun code n'est accepté depuis cette adresse. */
class EchecsParAdresse {
  private readonly echecs = new Map<string, { nombre: number; depuis: number }>();

  bloque(ip: string): boolean {
    const e = this.echecs.get(ip);
    if (!e) return false;
    if (Date.now() - e.depuis > FENETRE_ECHECS_MS) {
      this.echecs.delete(ip);
      return false;
    }
    return e.nombre >= MAX_ECHECS_ADRESSE;
  }

  noter(ip: string): void {
    const e = this.echecs.get(ip);
    if (e && Date.now() - e.depuis <= FENETRE_ECHECS_MS) e.nombre += 1;
    else this.echecs.set(ip, { nombre: 1, depuis: Date.now() });
  }

  effacer(ip: string): void {
    this.echecs.delete(ip);
  }
}

export function routeAppairage(
  annuaire: Annuaire,
  plafond: PlafondEchecs,
  journal: Logger,
): (req: Request, serveur: Serveur) => Promise<Response> {
  const echecs = new EchecsParAdresse();
  return async (req, serveur) => {
    const ip = ipDe(req, serveur.requestIP(req)?.address);
    const corps = await lireCorps(req, CorpsAppairage);
    if (corps instanceof Response) return corps;
    try {
      return echanger(annuaire, plafond, echecs, { ip, corps }, journal);
    } catch (e) {
      journal.error({ err: e, ip }, 'appairage : erreur de l’annuaire');
      return erreur('appairage impossible, réessaie', 500);
    }
  };
}

function echanger(
  annuaire: Annuaire,
  plafond: PlafondEchecs,
  echecs: EchecsParAdresse,
  { ip, corps }: { ip: string; corps: z.infer<typeof CorpsAppairage> },
  journal: Logger,
): Response {
  if (plafond.atteint() || echecs.bloque(ip)) return erreur('trop de tentatives, réessaie plus tard', 429);
  // Consommer le code et inscrire le membre forment un seul bloc : un échec ne laisse ni code brûlé ni membre à moitié.
  const inscrit = annuaire.enTransaction(() => {
    const code = annuaire.consommerCodeAppairage(empreinteCode(corps.code));
    return code === null ? null : enregistrer(annuaire, corps, code, journal);
  });
  if (inscrit === null) {
    echecs.noter(ip);
    plafond.noter();
    journal.warn({ ip }, 'appairage refusé : code faux ou expiré');
    return erreur('code refusé ou expiré', 401);
  }
  echecs.effacer(ip);
  return json(inscrit);
}

// Un code « même propriétaire » inscrit le membre chez son émetteur. Une invitation crée un propriétaire neuf, dont le
// membre porte le nom donné par Chris à l'invitation, et déclare le lien duo avec le propriétaire de Chris.
function enregistrer(
  annuaire: Annuaire,
  corps: z.infer<typeof CorpsAppairage>,
  code: CodeConsomme,
  journal: Logger,
): { id: string; jeton: string; proprietaire: string } {
  const id = randomBytes(6).toString('hex');
  const jeton = randomBytes(32).toString('base64url');
  const invitation = code.portee === 'invitation_duo';
  const proprietaire = code.portee === 'invitation_duo' ? proprietaireInvite(code.nomInvite) : code.proprietaire;
  annuaire.creerMembre({
    id,
    genre: corps.genre,
    nom: code.portee === 'invitation_duo' ? code.nomInvite : corps.nom,
    proprietaire,
    empreinteCle: empreinteSha256(corps.cle),
    jetonEmpreinte: empreinteSha256(jeton),
  });
  if (invitation) annuaire.lierDuo(code.proprietaire, proprietaire);
  journal.info({ membre: id, genre: corps.genre, proprietaire, portee: code.portee }, 'membre appairé');
  return { id, jeton, proprietaire };
}
