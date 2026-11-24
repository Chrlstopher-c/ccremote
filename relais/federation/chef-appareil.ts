// Responsabilité : le téléphone chef servi par son nœud (préfixe `/api/reseau/telephone/`) — lit la charte, la
// fait adopter quand il l'a signée, agit sur les machines par un ordre signé, voit et tranche les demandes
// d'appairage, et relaie les routes d'ajout et d'activité. Le membre est celui du canal chiffré ; le chef est
// celui de la charte ; la signature est vérifiée ici comme par chaque nœud qui applique. Rien n'est persisté ici.
import type { Logger } from 'pino';
import { z } from 'zod';
import { type Charte, type CharteSignee, lireCharte, membreDe } from '../../commun/charte.ts';
import { OrdreSigne, TAILLE_MAX_CHARTE_CARACTERES } from '../../commun/federation.ts';
import { NoncesVus, verifierOrdre } from '../../commun/ordre-machine.ts';
import type { ActionMachine } from './actions-noeud.ts';
import {
  correspondance,
  type DemandeAppareil,
  type MethodeApi,
  type ReponseAppareil,
  type ServirAppareil,
} from './appareils.ts';
import type { DemandeAppairage } from './demandes.ts';
import type { MachineReseau } from './etat-federation.ts';
import { echec, type Resultat } from './resultat.ts';

/** Ce que le téléphone chef utilise du nœud : la charte, la machine, la décision sur les demandes, les actions. */
export interface PortChefAppareil {
  readonly journal: Logger;
  charte(): Charte | null;
  signee(): CharteSignee | null;
  moi(): string | null;
  estChef(membre: string): boolean;
  proposer(signee: CharteSignee): Promise<Resultat<Charte>>;
  machinesReseau(): Promise<MachineReseau[]>;
  agir(membre: string, action: ActionMachine, origine: string, ordre: OrdreSigne): Promise<Resultat<null>>;
  demandes(): readonly DemandeAppairage[];
  decider(id: string, accord: boolean): boolean;
  /** Rejoue une requête sur les routes locales du nœud (absent : 503). */
  readonly rejouer?: ServirAppareil;
}

const PREFIXE = '/api/reseau/telephone';
const MEMBRE = /^[a-f0-9]{12}$/;
const ID_DEMANDE = z.string().min(1).max(64);
const CorpsCharte = z.strictObject({
  texte: z.string().min(2).max(TAILLE_MAX_CHARTE_CARACTERES),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  demande: ID_DEMANDE.optional(),
});
const CorpsOrdre = z.strictObject({ ordre: OrdreSigne });

type Niveau = 'membre' | 'chef';
type Gestion = (membre: string, params: Record<string, string>, demande: DemandeAppareil) => Promise<ReponseAppareil>;
interface Route {
  readonly methode: MethodeApi;
  readonly modele: string;
  readonly gerer: Gestion;
}

/** Vrai si le chemin (query exclue) est une route du téléphone chef : le nœud la lui confie avant tout refus. */
export function estRouteTelephone(chemin: string): boolean {
  return sansRequete(chemin).startsWith(`${PREFIXE}/`);
}

function reponse(statut: number, corps: unknown): ReponseAppareil {
  return { statut, corps: JSON.stringify(corps) };
}

function erreur(statut: number, message: string): ReponseAppareil {
  return reponse(statut, { erreur: message });
}

function sansRequete(chemin: string): string {
  const indice = chemin.indexOf('?');
  return indice < 0 ? chemin : chemin.slice(0, indice);
}

function requete(chemin: string): string {
  const indice = chemin.indexOf('?');
  return indice < 0 ? '' : chemin.slice(indice);
}

function lireCorps<S extends z.ZodType>(brut: string | undefined, schema: S): z.infer<S> | null {
  if (brut === undefined) return null;
  try {
    const lu = schema.safeParse(JSON.parse(brut));
    return lu.success ? lu.data : null;
  } catch {
    return null;
  }
}

export class ChefAppareil {
  private readonly nonces = new NoncesVus();
  private readonly routes: readonly Route[];

  constructor(private readonly port: PortChefAppareil) {
    this.routes = [...this.routesLecture(), ...this.routesEdition(), ...this.routesRejeu()];
  }

  /** Sert une requête d'un téléphone (membre = identité du canal) ; toute erreur devient une 500, journalisée. */
  async servir(membre: string, demande: DemandeAppareil): Promise<ReponseAppareil> {
    try {
      return await this.router(membre, demande);
    } catch (erreurInterne) {
      this.port.journal.error({ err: erreurInterne, membre }, 'téléphone chef : route en échec');
      return erreur(500, 'erreur interne');
    }
  }

  private router(membre: string, demande: DemandeAppareil): Promise<ReponseAppareil> {
    const chemin = sansRequete(demande.chemin);
    for (const route of this.routes) {
      if (route.methode !== demande.methode) continue;
      const params = correspondance(route.modele, chemin);
      if (params !== null) return route.gerer(membre, params, demande);
    }
    return Promise.resolve(erreur(404, 'route inconnue'));
  }

  private routesLecture(): Route[] {
    return [
      { methode: 'GET', modele: `${PREFIXE}/charte`, gerer: (m) => Promise.resolve(this.voirCharte(m)) },
      { methode: 'GET', modele: `${PREFIXE}/machines`, gerer: (m) => this.voirMachines(m) },
      { methode: 'GET', modele: `${PREFIXE}/demandes`, gerer: (m) => Promise.resolve(this.voirDemandes(m)) },
    ];
  }

  private routesEdition(): Route[] {
    return [
      { methode: 'POST', modele: `${PREFIXE}/charte`, gerer: (m, _p, d) => this.proposerCharte(m, d) },
      { methode: 'POST', modele: `${PREFIXE}/machines/:membre/action`, gerer: (m, p, d) => this.agirMachine(m, p, d) },
      {
        methode: 'POST',
        modele: `${PREFIXE}/demandes/:id/refuser`,
        gerer: (m, p) => Promise.resolve(this.refuserDemande(m, p)),
      },
    ];
  }

  private routesRejeu(): Route[] {
    const rejeu = (cible: string) => (m: string, _p: Record<string, string>, d: DemandeAppareil) =>
      this.rejouer(m, cible, d);
    return [
      { methode: 'POST', modele: `${PREFIXE}/codes`, gerer: rejeu('/api/federation/codes') },
      { methode: 'GET', modele: `${PREFIXE}/ajouts`, gerer: rejeu('/api/reseau/ajouts') },
      { methode: 'POST', modele: `${PREFIXE}/ajouts`, gerer: rejeu('/api/reseau/ajouts') },
      {
        methode: 'POST',
        modele: `${PREFIXE}/ajouts/:machine/retour`,
        gerer: (m, p, d) => this.rejouer(m, `/api/reseau/ajouts/${encodeURIComponent(p['machine'] ?? '')}/retour`, d),
      },
      {
        methode: 'GET',
        modele: `${PREFIXE}/invites/:membre/activite`,
        gerer: (m, p, d) => this.rejouerInvite(m, p, d),
      },
    ];
  }

  /** Refus avant toute action : pas de charte (409), membre absent (403), ou pas chef (403). Null si tout va. */
  private exiger(membre: string, niveau: Niveau): ReponseAppareil | null {
    const charte = this.port.charte();
    if (charte === null) return erreur(409, 'aucun réseau sur ce nœud');
    if (niveau === 'membre' && membreDe(charte, membre) === null) return erreur(403, 'appareil hors du réseau');
    if (niveau === 'chef' && !this.port.estChef(membre)) return erreur(403, 'réservé aux chefs du réseau');
    return null;
  }

  /** Forme commune : la charte (ou null), la signée, ce nœud, ce téléphone, et s'il est chef. */
  private vue(membre: string): Record<string, unknown> {
    return {
      charte: this.port.charte(),
      signee: this.port.signee(),
      noeud: this.port.moi(),
      appareil: membre,
      chef: this.port.estChef(membre),
    };
  }

  private voirCharte(membre: string): ReponseAppareil {
    const charte = this.port.charte();
    if (charte !== null && membreDe(charte, membre) === null) return erreur(403, 'appareil hors du réseau');
    return reponse(200, this.vue(membre));
  }

  private async voirMachines(membre: string): Promise<ReponseAppareil> {
    const refus = this.exiger(membre, 'membre');
    if (refus) return refus;
    return reponse(200, { machines: await this.port.machinesReseau() });
  }

  private voirDemandes(membre: string): ReponseAppareil {
    const refus = this.exiger(membre, 'chef');
    if (refus) return refus;
    const demandes = this.port.demandes().flatMap((d) =>
      d.membre !== undefined && d.identite !== undefined
        ? [{ id: d.id, membre: d.membre, nom: d.nom, genre: d.genre, identite: d.identite, le: d.le }]
        : [],
    );
    return reponse(200, { demandes });
  }

  /** Charte signée par ce téléphone (son `par`), proposée au nœud ; la demande d'appairage liée est tranchée. */
  private async proposerCharte(membre: string, demande: DemandeAppareil): Promise<ReponseAppareil> {
    const refus = this.exiger(membre, 'chef');
    if (refus) return refus;
    const corps = lireCorps(demande.corps, CorpsCharte);
    if (corps === null) return erreur(400, 'corps invalide');
    if (lireCharte(corps.texte)?.par !== membre) return erreur(403, 'signataire autre que cet appareil');
    const r = await this.port.proposer({ texte: corps.texte, signature: corps.signature });
    if (!r.ok) return erreur(r.statut, r.raison);
    if (corps.demande === undefined) return reponse(200, this.vue(membre));
    const decision = this.port.decider(corps.demande, true) ? 'acceptee' : 'introuvable';
    return reponse(200, { ...this.vue(membre), demande: decision });
  }

  private async agirMachine(
    membre: string,
    params: Record<string, string>,
    demande: DemandeAppareil,
  ): Promise<ReponseAppareil> {
    const refus = this.exiger(membre, 'chef');
    if (refus) return refus;
    const cible = params['membre'] ?? '';
    if (!MEMBRE.test(cible)) return erreur(400, 'machine invalide');
    const corps = lireCorps(demande.corps, CorpsOrdre);
    if (corps === null) return erreur(400, 'corps invalide');
    const verdict = await verifierOrdre(this.port.charte(), corps.ordre, {
      cible,
      maintenantMs: Date.now(),
      nonces: this.nonces,
    });
    if (!verdict.ok) return erreur(403, `ordre refusé : ${verdict.motif}`);
    const r = await this.port.agir(cible, verdict.ordre.action, `appareil:${membre}`, corps.ordre);
    return r.ok ? reponse(200, { ok: true }) : erreur(r.statut, r.raison);
  }

  private refuserDemande(membre: string, params: Record<string, string>): ReponseAppareil {
    const refus = this.exiger(membre, 'chef');
    if (refus) return refus;
    if (!this.port.decider(params['id'] ?? '', false)) return erreur(404, 'demande introuvable');
    return reponse(200, { ok: true });
  }

  /** Rejoue la requête du téléphone (même corps, même query) sur la route locale du nœud, s'il est chef. */
  private async rejouer(membre: string, cible: string, demande: DemandeAppareil): Promise<ReponseAppareil> {
    const refus = this.exiger(membre, 'chef');
    if (refus) return refus;
    const servir = this.port.rejouer;
    if (servir === undefined) return erreur(503, 'API du téléphone non branchée');
    return servir({ methode: demande.methode, chemin: cible + requete(demande.chemin), corps: demande.corps });
  }

  private rejouerInvite(
    membre: string,
    params: Record<string, string>,
    demande: DemandeAppareil,
  ): Promise<ReponseAppareil> {
    const invite = params['membre'] ?? '';
    if (!MEMBRE.test(invite)) return Promise.resolve(erreur(400, 'membre invalide'));
    return this.rejouer(membre, `/api/reseau/invites/${invite}/activite`, demande);
  }
}
