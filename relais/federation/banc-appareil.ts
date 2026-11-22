// Responsabilité : banc d'essai d'un appareil client (genre « appareil ») relié à un nœud par l'aiguilleur réel —
// machine à états du canal côté appareil, réassemblage des morceaux, et création d'un nœud servant l'API clients.
import pino from 'pino';
import { type MessageVersAiguilleur, analyserDeAiguilleur, CHEMIN_APPAIRAGE_MEMBRE } from '../../commun/aiguilleur.ts';
import { exporterIdentitePublique, genererIdentite, type Identite } from '../../commun/chiffrement/identite.ts';
import { type MessageChiffre, TAILLE_MORCEAU_APPAREIL_CARACTERES } from '../../commun/federation.ts';
import { attendre, codeAppairage, creerNoeud, monterAiguilleur, type Monte, type Noeud, relier } from './banc-federation.ts';
import { CanalNoeud, type HoteCanal, type PresentationDistante } from './canal.ts';
import { servirAppareil } from './appareils.ts';
import type { TableInterne } from './executeur.ts';
import type { PairFederee } from './secrets.ts';
import type { OptionsFederation } from './federation.ts';

export const silencieux = pino({ enabled: false });
export const MAJ = '2026-11-22T10:00:00.000Z';
export const PROPRIETAIRE = 'chris';

export interface Reponse {
  readonly statut: number;
  readonly corps: string;
  readonly codage?: string;
  readonly type?: string;
}

/** Une réponse en flux, réunie. `premierMs` et `finMs` : délais depuis l'envoi de la requête (premier son). */
export interface ReponseFluxRecue {
  readonly statut: number;
  readonly type?: string;
  readonly octets: Uint8Array;
  readonly ok: boolean;
  readonly premierMs: number | null;
  readonly finMs: number;
}

interface FluxEnCours {
  readonly debut: number;
  readonly resoudre: (r: ReponseFluxRecue) => void;
  premierMs: number | null;
  statut?: number;
  type?: string;
  morceaux: Uint8Array[];
}

/** Un appareil de test : identité propre, membre de l'aiguilleur, machine à états du canal côté appareil. */
export class Appareil {
  readonly canaux = new Map<string, CanalNoeud>();
  readonly ouverts: string[] = [];
  readonly fermes: string[] = [];
  readonly refusees: string[] = [];
  /** Corps JSON des diffusions reçues, dans l'ordre (morceaux réunis). */
  readonly diffusions: string[] = [];
  /** Sorties et fins des terminaux, par identifiant de terminal (octets reçus, en base64). */
  readonly sorties = new Map<string, string[]>();
  readonly reponsesTerminal = new Map<string, { ok: boolean; raison?: string }>();
  pairs: PairFederee[] = [];
  membre = '';
  private ws: WebSocket | null = null;
  private readonly reponses = new Map<string, (r: Reponse) => void>();
  private readonly morceaux = new Map<string, string[]>();
  private readonly fluxEnCours = new Map<string, FluxEnCours>();
  private compteur = 0;

  constructor(readonly identite: Identite) {}

  /** Appairage à l'aiguilleur par code (membre appareil), puis lien sortant authentifié. */
  async rejoindre(monte: Monte, code: string): Promise<void> {
    const r = await fetch(`${monte.url}${CHEMIN_APPAIRAGE_MEMBRE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        nom: 'iphone',
        genre: 'appareil',
        cle: exporterIdentitePublique(this.identite.publique),
      }),
    });
    const corps = (await r.json()) as { id: string; jeton: string };
    this.membre = corps.id;
    const url = `${monte.url.replace('http', 'ws')}/aiguilleur`;
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${corps.jeton}` } });
    ws.onmessage = (ev) => this.recevoirAiguilleur(String(ev.data));
    await new Promise<void>((ok, ko) => {
      ws.onopen = () => ok();
      ws.onerror = () => ko(new Error('lien aiguilleur refusé'));
    });
    this.ws = ws;
  }

  ouvrir(id: string, vers: string, intention: 'appairage' | 'lien'): CanalNoeud {
    const canal = new CanalNoeud(id, vers, intention, 'ouvrant', this.hote());
    this.canaux.set(id, canal);
    this.envoyer({ t: 'ouvrir', canal: id, vers });
    return canal;
  }

  /** Une requête de l'API clients dans le canal ; statut 0 si le canal est fermé. */
  appeler(canal: CanalNoeud, chemin: string, extra: Record<string, unknown> = {}): Promise<Reponse> {
    const ref = this.suivant();
    return new Promise((ok) => {
      this.reponses.set(ref, ok);
      if (!canal.envoyer({ t: 'api', ref, methode: 'GET', chemin, ...extra } as MessageChiffre)) {
        this.reponses.delete(ref);
        ok({ statut: 0, corps: '' });
      }
    });
  }

  /** Une requête `?flux=1` dans le canal : la réponse est rendue entière, à la fin du flux (ou de la réponse). */
  appelerFlux(canal: CanalNoeud, chemin: string, corps: string): Promise<ReponseFluxRecue> {
    const ref = this.suivant();
    return new Promise((ok) => {
      this.fluxEnCours.set(ref, { debut: performance.now(), resoudre: ok, premierMs: null, morceaux: [] });
      if (!canal.envoyer({ t: 'api', ref, methode: 'POST', chemin, corps })) {
        this.fluxEnCours.delete(ref);
        ok({ statut: 0, octets: new Uint8Array(), ok: false, premierMs: null, finMs: 0 });
      }
    });
  }

  /** Un message chiffré quelconque, avec sa référence de requête (morceaux d'abord, comme la fédération). */
  envoyerGros(canal: CanalNoeud, message: MessageChiffre & { ref: string; corps?: string }): boolean {
    const corps = message.corps ?? '';
    const taille = TAILLE_MORCEAU_APPAREIL_CARACTERES;
    if (corps.length <= taille) return canal.envoyer(message);
    const morceaux = Math.ceil(corps.length / taille);
    for (let rang = 0; rang < morceaux; rang++) {
      const tranche = corps.slice(rang * taille, (rang + 1) * taille);
      canal.envoyer({ t: 'morceau', ref: message.ref, rang, corps: tranche });
    }
    return canal.envoyer({ ...message, corps: '', morceaux } as MessageChiffre);
  }

  /** Attend la réponse d'une requête déjà envoyée (même référence que `reponses`). */
  attendreReponse(ref: string): Promise<Reponse> {
    return new Promise((ok) => this.reponses.set(ref, ok));
  }

  suivant(): string {
    this.compteur += 1;
    return `r${this.compteur}`;
  }

  private envoyer(message: MessageVersAiguilleur): boolean {
    this.ws?.send(JSON.stringify(message));
    return true;
  }

  private recevoirAiguilleur(brut: string): void {
    const message = analyserDeAiguilleur(JSON.parse(brut));
    if (!message) return;
    if (message.t === 'accepter') return void this.canaux.get(message.canal)?.surAccepter();
    if (message.t === 'refuser') return this.canaux.get(message.canal)?.surRefus();
    if (message.t === 'donnees') return void this.canaux.get(message.canal)?.surDonnees(message.charge);
    if (message.t === 'fermer') return this.canaux.get(message.canal)?.surFermetureDistante();
  }

  private recevoir(canal: CanalNoeud, message: MessageChiffre): void {
    if (message.t === 'api_flux') return this.entete(message.ref, message.statut, message.type);
    if (message.t === 'api_fin') return this.finirFlux(message.ref, message.morceaux, message.ok);
    if (message.t === 'morceau') return this.morceau(message.ref, message.rang, message.corps);
    if (message.t === 'api_reponse' && this.fluxEnCours.has(message.ref)) {
      const corps = this.reunir(message.ref, message.corps, message.morceaux);
      const octets = message.codage === 'base64' ? Buffer.from(corps, 'base64') : new TextEncoder().encode(corps);
      return this.finirFlux(message.ref, 0, true, { statut: message.statut, type: message.type, octets });
    }
    if (message.t === 'api_reponse') {
      return this.reponses.get(message.ref)?.({
        statut: message.statut,
        corps: this.reunir(message.ref, message.corps, message.morceaux),
        codage: message.codage,
        type: message.type,
      });
    }
    if (message.t === 'diffusion') return void this.diffusions.push(this.reunir(message.ref, message.corps, message.morceaux));
    if (message.t === 'diffusion_ouverte') return void this.acquitter.push(canal.id);
    if (message.t === 'reponse') return void this.reponsesTerminal.set(message.ref, { ok: message.ok, raison: message.raison });
    if (message.t === 'terminal_sortie') return void this.empiler(message.terminal, message.base64);
    if (message.t === 'revocation') return canal.fermer();
    this.horsProtocole.push(message.t);
  }

  /** Diffusions acquittées (identifiants de canal), dans l'ordre. */
  readonly acquitter: string[] = [];
  /** Messages qu'un appareil ne connaît pas (l'iPhone fermerait son canal) : doit rester vide. */
  readonly horsProtocole: string[] = [];

  private entete(ref: string, statut: number, type?: string): void {
    const flux = this.fluxEnCours.get(ref);
    if (!flux) return;
    flux.statut = statut;
    flux.type = type;
  }

  // Un morceau d'un flux (en-tête reçu) part tout de suite au compte-gouttes ; sinon il est d'un corps en morceaux.
  private morceau(ref: string, rang: number, corps: string): void {
    const flux = this.fluxEnCours.get(ref);
    if (!flux || flux.statut === undefined) return this.ajouterMorceau(ref, rang, corps);
    flux.premierMs ??= performance.now() - flux.debut;
    if (rang === flux.morceaux.length) flux.morceaux.push(Buffer.from(corps, 'base64'));
  }

  private finirFlux(
    ref: string,
    morceaux: number,
    ok: boolean,
    entier?: { statut: number; type?: string; octets: Uint8Array },
  ): void {
    const flux = this.fluxEnCours.get(ref);
    if (!flux) return;
    this.fluxEnCours.delete(ref);
    const finMs = performance.now() - flux.debut;
    const reunis = entier ?? { statut: flux.statut ?? 0, type: flux.type, octets: concatener(flux.morceaux) };
    const complet = ok && (entier !== undefined || flux.morceaux.length === morceaux);
    flux.resoudre({ ...reunis, ok: complet, premierMs: entier ? finMs : flux.premierMs, finMs });
  }

  private ajouterMorceau(ref: string, rang: number, corps: string): void {
    const liste = this.morceaux.get(ref) ?? [];
    liste[rang] = corps;
    this.morceaux.set(ref, liste);
  }

  // Le corps d'une réponse ou d'une diffusion : tel quel, ou réuni depuis ses morceaux.
  private reunir(ref: string, corps: string, morceaux?: number): string {
    if (morceaux === undefined) return corps;
    const liste = this.morceaux.get(ref) ?? [];
    this.morceaux.delete(ref);
    return liste.slice(0, morceaux).join('');
  }

  private empiler(terminal: string, base64: string): void {
    const liste = this.sorties.get(terminal) ?? [];
    liste.push(base64);
    this.sorties.set(terminal, liste);
  }

  hote(): HoteCanal {
    return {
      journal: silencieux,
      delaiAppairageMs: 5000,
      identiteLocale: async () => this.identite,
      nomLocal: () => 'iphone',
      genreLocal: () => 'appareil',
      pairDe: (membre) => this.pairs.find((p) => p.id === membre) ?? null,
      envoyerAiguilleur: (m) => this.envoyer(m),
      presentationRecue: () => undefined,
      appairageAccepte: (canal, p: PresentationDistante) => {
        this.pairs = [...this.pairs.filter((x) => x.id !== canal.membre), {
          id: canal.membre, nom: p.nom, identite: p.identite, creeLe: MAJ, genre: 'noeud',
        }];
      },
      appairageRefuse: () => undefined,
      liaisonOuverte: (canal) => void this.ouverts.push(canal.id),
      liaisonRefusee: (_canal, raison) => void this.refusees.push(raison),
      messageRecu: (canal, m) => this.recevoir(canal, m),
      canalFerme: (canal) => {
        this.canaux.delete(canal.id);
        this.fermes.push(canal.id);
      },
    };
  }
}

export const TABLE_PAR_DEFAUT: TableInterne = {
  '/api/etat': { GET: () => Response.json({ machine: 'tour' }) },
  '/api/federation/aiguilleur': { POST: () => new Response('jamais') },
};

/** Un nœud qui sert l'API clients à ses appareils, relié à l'aiguilleur de `monte`. */
export async function nouveauNoeud(monte: Monte, table: TableInterne = TABLE_PAR_DEFAUT, options: Partial<OptionsFederation> = {}) {
  const noeud = creerNoeud('tour', { servirAppareil: servirAppareil(table, silencieux), ...options });
  const id = await relier(noeud, monte, PROPRIETAIRE);
  await attendre(async () => (await noeud.federation.etat()).aiguilleur?.relie === true);
  return { noeud, id };
}

export async function appareilAvecCode(monte: Monte): Promise<Appareil> {
  const appareil = new Appareil(await genererIdentite());
  await appareil.rejoindre(monte, codeAppairage(monte, PROPRIETAIRE));
  return appareil;
}

/** Appairage accepté par Chris (décision simulée) : le canal `ap-1` est ouvert, l'appareil est appairé. */
export async function appairerAppareil(monte: Monte, noeud: Noeud, id: string) {
  const appareil = await appareilAvecCode(monte);
  const canal = appareil.ouvrir('ap-1', id, 'appairage');
  await attendre(async () => (await noeud.federation.etat()).demandes.some((d) => d.genre === 'appareil'));
  const demande = (await noeud.federation.etat()).demandes.find((d) => d.genre === 'appareil');
  noeud.federation.decider(demande?.id ?? '', true);
  await attendre(() => appareil.ouverts.includes('ap-1'));
  return { appareil, canal };
}

export { creerNoeud, monterAiguilleur, attendre };

function concatener(morceaux: Uint8Array[]): Uint8Array {
  const total = morceaux.reduce((somme, m) => somme + m.byteLength, 0);
  const sortie = new Uint8Array(total);
  let decalage = 0;
  for (const m of morceaux) {
    sortie.set(m, decalage);
    decalage += m.byteLength;
  }
  return sortie;
}
