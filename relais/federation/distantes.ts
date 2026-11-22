// Responsabilité : les sessions des autres nœuds vues depuis ce nœud — liste fusionnée pour l'appli (sans doublon
// avec les tunnels SSH), annonce de leurs changements sur le flux des clients, et gestes de l'appli relayés au nœud qui tient
// la session (même route, exécutée là-bas). Rien n'entre dans la base : tout vit dans le cache mémoire.
import type { Logger } from 'pino';
import type { MessageClient, VueMachine } from '../../commun/api-clients.ts';
import {
  type EvenementFedere,
  type MessageChiffre,
  TAILLE_MORCEAU_CARACTERES,
} from '../../commun/federation.ts';
import type { ConfirmationDemandee } from '../../commun/api-clients.ts';
import { ResumeSession } from '../../commun/session.ts';
import { ID_MEMBRE } from '../../commun/charte-droits.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Registre } from '../registre/registre.ts';
import type { CanalNoeud } from './canal.ts';
import { CacheDistant, type FluxDistant, type SessionDistante } from './distant.ts';
import { type Echanges, type GesteLocal } from './echanges.ts';
import { lireRoute, type RouteDemandee } from './gestes.ts';
import { estGesteRelayable } from '../../commun/gestes-federes.ts';
import { decouper, nombreDeMorceaux, tropGrandPourTransfert } from './transferts.ts';
import { echec, ok, type Resultat } from './resultat.ts';
import { fusionnerVue, type VueFederee } from './vue-federee.ts';

/** Délai d'un geste qui lance du travail chez le nœud (ouvrir, écrire) ; les lectures gardent le délai court. */
const DELAI_GESTE_LONG_MS = 60_000;
const DELAI_GESTE_MS = 20_000;
const GESTES_LONGS: ReadonlySet<string> = new Set(['ouvrir', 'messages', 'git/commiter']);
const TEXTE_HORS_LIGNE = 'machine hors ligne : la session est sur un autre nœud du réseau';
const TEXTE_INDISPONIBLE = 'geste indisponible pour une session d’une autre machine : le faire depuis elle';
const TEXTE_AMI_SANS_CHARTE = 'requête d’ami non relayée : son identifiant n’est pas celui de la charte';

export interface OptionsDistantes {
  readonly registre: Registre;
  readonly diffusion: Diffusion;
  readonly machine: string;
  readonly cache: CacheDistant;
  readonly echanges: Echanges;
  readonly liaison: (membre: string) => CanalNoeud | null;
  readonly journal: Logger;
}

interface Etat {
  readonly fed: Map<string, string>;
  readonly masquees: ReadonlySet<string>;
  readonly machines: Map<string, string>;
}

export class Distantes {
  private machinesLocales: () => VueMachine[] = () => [];
  private derniere: VueFederee | null = null;
  private etat: Etat = { fed: new Map(), masquees: new Set(), machines: new Map() };
  private readonly depuisMembre = new Map<string, string>();
  private readonly enLigneMembre = new Map<string, boolean>();
  private enEmission = false;

  private membreVoix: string | null = null;

  constructor(private readonly o: OptionsDistantes) {
    o.cache.observateur = {
      changement: () => this.surChangement(),
      evenement: (membre, session, evt) => this.surEvenement(membre, session, evt),
      flux: (membre, message) => this.surFlux(membre, message),
      confirmation: (_membre, confirmation) => this.surConfirmation(confirmation),
    };
  }

  /** Les machines locales (vues des postes) : branchées une fois le parc construit. */
  brancherMachines(lire: () => VueMachine[]): void {
    this.machinesLocales = lire;
  }

  sessions(): SessionDistante[] {
    return this.o.cache.sessions();
  }

  /** La vue de l'appli : sessions et machines locales fusionnées avec celles des nœuds appariés. */
  vue(locales: readonly ResumeSession[], machines: readonly VueMachine[]): VueFederee {
    const v = fusionnerVue({
      locales,
      machinesLocales: machines,
      machineLocale: this.o.machine,
      noeuds: this.o.cache.noeudsConnus(),
      depuis: (m) => this.depuisMembre.get(m) ?? new Date(0).toISOString(),
    });
    this.derniere = v;
    return v;
  }

  estDistante(session: string): boolean {
    return this.vueCourante().routage.has(session);
  }

  /** Une confirmation venue d'un pair (réglée ou non) : elle ne se renvoie pas. */
  estConfirmationDistante(id: string): boolean {
    return this.o.cache.estConfirmationDistante(id);
  }

  /** Le nœud qui tient une session d'un autre nœud, ou null si elle est locale (ou inconnue). */
  membreDe(session: string): string | null {
    return this.vueCourante().routage.get(session) ?? null;
  }

  /**
   * Filtre du flux des clients : les copies locales d'une machine tenue par un nœud en ligne ne passent pas (même
   * identifiant de session que la version fédérée : la copie périmée écraserait celle du nœud). Une copie archivée
   * ici reste ici, sauf si la vue montre la version vivante du nœud (même identifiant) : elle ne passe pas non plus.
   * Ce que ce nœud émet lui-même (version fédérée) passe toujours.
   */
  laisserPasser(m: MessageClient): boolean {
    if (this.enEmission) return true;
    // Lu à l'instant (pas la vue mémorisée) : une copie arrivée entre deux calculs de la vue est filtrée aussi.
    if (m.type === 'session') {
      if (this.vueCourante().routage.has(m.session.id)) return false;
      return m.session.archivee === true || !this.machinesTenues().has(m.session.machine);
    }
    if (m.type === 'evenement') return !this.sessionsTenues().has(m.evenement.sessionId);
    if (m.type === 'machine') return !this.derniere?.machinesRoutees.has(m.machine.id);
    return true;
  }

  /** Machines dont un autre nœud en ligne est la machine (une copie locale de l'une d'elles se tait sur le flux). */
  private machinesTenues(): Set<string> {
    return new Set(
      this.o.cache
        .noeudsConnus()
        .filter((n) => n.enLigne && n.machine !== this.o.machine)
        .map((n) => n.machine),
    );
  }

  /** Sessions annoncées par un autre nœud en ligne : leurs événements locaux (copies) ne passent pas. */
  private sessionsTenues(): Set<string> {
    return new Set(
      this.o.cache
        .noeudsConnus()
        .filter((n) => n.enLigne && n.machine !== this.o.machine)
        .flatMap((n) => n.sessions.map((s) => s.id)),
    );
  }

  /** Requête de l'appli (déjà authentifiée) : relayée si elle vise une session ou une machine d'un autre nœud. */
  async intercepter(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (url.pathname === '/api/sessions') return req.method === 'POST' ? this.intercepterOuverture(req) : null;
    const route = lireRoute(url, req.method);
    if (!route) return null;
    const membre = this.membreDeRoute(route);
    if (!membre) return null;
    if (!estGesteRelayable(route.portee, route.geste)) return reponseErreur(409, TEXTE_INDISPONIBLE);
    const corps = req.method === 'GET' ? '' : await req.text();
    return this.relayer(membre, gesteDe(route), corps);
  }

  // Le nœud qui tient la cible de la route : session, machine, ou la confirmation qu'il a demandée. Les artefacts
  // sont lus ici et là (fusion dans la route locale) : jamais relayés, donc sans nœud.
  private membreDeRoute(route: RouteDemandee): string | null {
    const vue = this.vueCourante();
    if (route.portee === 'session') return vue.routage.get(route.id) ?? null;
    if (route.portee === 'machine') return vue.machinesRoutees.get(route.id) ?? null;
    if (route.geste === 'artefacts') return null;
    return this.o.cache.membreDeConfirmation(route.geste.split('/')[1] ?? '');
  }

  /** Les listes du nœud (artefacts) de chaque pair en ligne, lues par `local=1` : chacun ne rend que les siennes. */
  async artefactsDesPairs(): Promise<unknown[]> {
    const membres = this.o.cache.noeudsConnus().filter((n) => n.enLigne).map((n) => n.membre);
    const reponses = await Promise.all(
      membres.map((membre) => this.relayer(membre, { geste: 'artefacts', methode: 'GET', requete: 'local=1' }, '')),
    );
    const listes = await Promise.all(reponses.map((r) => (r.ok ? r.json().catch(() => null) : null)));
    return listes.flatMap((liste: unknown) => (Array.isArray(liste) ? liste : []));
  }

  /** Synthèse vocale demandée à un pair en ligne (celui qui a déjà parlé d'abord) ; null si aucun n'a de voix. */
  async voixDesPairs(corps: string): Promise<Response | null> {
    const membres = this.o.cache.noeudsConnus().filter((n) => n.enLigne).map((n) => n.membre);
    const ordre = this.membreVoix && membres.includes(this.membreVoix)
      ? [this.membreVoix, ...membres.filter((m) => m !== this.membreVoix)]
      : membres;
    for (const membre of ordre) {
      const reponse = await this.relayer(membre, { geste: 'voix', methode: 'POST', requete: 'local=1' }, corps);
      if (reponse.ok) {
        this.membreVoix = membre;
        return reponse;
      }
    }
    return null;
  }

  /** L'état du service de voix des postes de chaque pair en ligne (`local=1` : les siens seuls), listes aplaties. */
  async voixServiceDesPairs(): Promise<unknown[]> {
    const membres = this.o.cache.noeudsConnus().filter((n) => n.enLigne).map((n) => n.membre);
    const reponses = await Promise.all(
      membres.map((membre) => this.relayer(membre, { geste: 'voix/service', methode: 'GET', requete: 'local=1' }, '')),
    );
    const corps = await Promise.all(reponses.map((r) => (r.ok ? r.json().catch(() => null) : null)));
    return corps.flatMap((c: unknown) => machinesDe(c));
  }

  /** Ouverture relayée vers un pair (ce nœud est invité : le chef décide). `ami` : au nom d'un ami du duo. */
  ouvrirChez(membre: string, corps: string, ami?: string): Promise<Response> {
    return this.relayer(membre, { geste: 'ouvrir', methode: 'POST', ...etiquette(ami) }, corps);
  }

  private async intercepterOuverture(req: Request): Promise<Response | null> {
    const corps = await req.clone().text();
    const machine = machineDe(corps);
    const membre = machine ? this.vueCourante().machinesRoutees.get(machine) : undefined;
    if (!membre) return null;
    return this.relayer(membre, { geste: 'ouvrir', methode: 'POST' }, corps);
  }

  private async relayer(membre: string, g: GesteLocal, corps: string): Promise<Response> {
    if (!etiquetteValide(g.ami)) return reponseErreur(403, TEXTE_AMI_SANS_CHARTE);
    const canal = this.o.liaison(membre);
    if (!canal) return reponseErreur(409, TEXTE_HORS_LIGNE);
    if (tropGrandPourTransfert(corps)) return reponseErreur(413, 'contenu trop grand pour le lien entre machines');
    const gros = corps.length > TAILLE_MORCEAU_CARACTERES || g.geste.startsWith('fichiers/');
    const long = GESTES_LONGS.has(g.geste) || gros;
    const reponse = await this.o.echanges.requeter(
      canal,
      (ref) => messagesDuGeste(ref, g, corps),
      long ? DELAI_GESTE_LONG_MS : DELAI_GESTE_MS,
    );
    if (!reponse || reponse.t !== 'geste_reponse') return reponseErreur(504, 'la machine n’a pas répondu à temps');
    if (g.geste === 'ouvrir' && reponse.statut < 300) this.connaitreOuverte(membre, reponse.corps);
    return reponseDuPair(reponse);
  }

  // L'appli règle la session neuve (effort, modèle…) dès la réponse : elle doit déjà être routée vers le nœud.
  private connaitreOuverte(membre: string, corps: string): void {
    try {
      const fiche = ResumeSession.safeParse(JSON.parse(corps));
      if (fiche.success) this.o.cache.ajouterSession(membre, fiche.data);
    } catch (erreur) {
      this.o.journal.warn({ err: erreur }, 'session ouverte chez un pair : fiche illisible');
    }
  }

  // ---- Gestes nommés (routes /api/federation/sessions/*) ------------------------------------------------------

  async fil(membre: string, session: string, ami?: string): Promise<Resultat<EvenementFedere[]>> {
    const r = await this.requete(membre, (ref, e) => ({ t: 'fil', ref, session, ...e }), ami);
    if (!r.ok) return r;
    return r.valeur.t === 'fil_reponse' ? ok(r.valeur.evenements) : echec(502, 'réponse inattendue');
  }

  filEnMemoire(membre: string, session: string): EvenementFedere[] {
    return this.o.cache.fil(membre, session);
  }

  async ecrire(membre: string, session: string, texte: string, ami?: string): Promise<Resultat<null>> {
    const r = await this.requete(membre, (ref, e) => ({ t: 'ecrire', ref, session, texte, ...e }), ami);
    return r.ok ? ok(null) : r;
  }

  async interrompre(membre: string, session: string, ami?: string): Promise<Resultat<null>> {
    const r = await this.requete(membre, (ref, e) => ({ t: 'interrompre', ref, session, ...e }), ami);
    return r.ok ? ok(null) : r;
  }

  /** Crée une session sur une machine du nœud visé, dans un dossier de cette machine. */
  async ouvrir(
    membre: string,
    machine: string,
    chemin: string,
    message: string,
    ami?: string,
  ): Promise<Resultat<{ session: string }>> {
    const r = await this.requete(membre, (ref, e) => ({ t: 'ouvrir', ref, machine, chemin, message, ...e }), ami);
    if (!r.ok) return r;
    if (r.valeur.t === 'reponse' && r.valeur.session) return ok({ session: r.valeur.session });
    return echec(502, 'session ouverte sans identifiant');
  }

  private async requete(
    membre: string,
    construire: (ref: string, etiquette: { ami?: string }) => MessageChiffre,
    ami?: string,
  ): Promise<Resultat<MessageChiffre>> {
    if (!etiquetteValide(ami)) return echec(403, TEXTE_AMI_SANS_CHARTE);
    const canal = this.o.liaison(membre);
    if (!canal) return echec(409, 'nœud hors ligne ou non relié');
    const reponse = await this.o.echanges.requeter(canal, (ref) => construire(ref, etiquette(ami)));
    if (!reponse) return echec(504, 'le nœud n’a pas répondu');
    if (reponse.t === 'reponse' && !reponse.ok) return echec(409, reponse.raison ?? 'refusé');
    return ok(reponse);
  }

  // ---- Annonces sur le flux des clients -----------------------------------------------------------------------

  private vueCourante(): VueFederee {
    return this.derniere ?? this.recalculer();
  }

  private recalculer(): VueFederee {
    return this.vue(this.o.registre.sessions(false), this.machinesLocales());
  }

  private surChangement(): void {
    try {
      this.noterPresences();
      const v = this.recalculer();
      this.annoncer(v);
    } catch (erreur) {
      this.o.journal.error({ err: erreur }, 'vue fédérée non recalculée');
    }
  }

  // Une confirmation d'un pair : l'interface la montre comme une demande locale (la réponse part vers le pair).
  private surConfirmation(confirmation: ConfirmationDemandee): void {
    this.o.diffusion.diffuser({ type: 'confirmation', confirmation });
  }

  // Le delta d'une session d'un pair : relayé à l'interface comme celui d'une session locale.
  private surFlux(membre: string, message: FluxDistant): void {
    if (this.vueCourante().routage.get(message.session) !== membre) return;
    this.o.diffusion.diffuser({
      type: 'flux',
      sessionId: message.session,
      bloc: message.bloc,
      delta: message.delta,
      ...(message.genre ? { genre: message.genre } : {}),
      ...(message.agent ? { agent: message.agent } : {}),
    });
  }

  private noterPresences(): void {
    for (const n of this.o.cache.noeudsConnus()) {
      if (this.enLigneMembre.get(n.membre) === n.enLigne) continue;
      this.enLigneMembre.set(n.membre, n.enLigne);
      this.depuisMembre.set(n.membre, new Date().toISOString());
    }
  }

  private annoncer(v: VueFederee): void {
    const avant = this.etat;
    const fed = new Map(v.sessions.filter((s) => v.routage.has(s.id)).map((s) => [s.id, JSON.stringify(s)]));
    const machines = new Map(v.machines.map((m) => [m.id, JSON.stringify(m)]));
    this.etat = { fed, masquees: v.masquees, machines };
    for (const [id, texte] of fed) if (avant.fed.get(id) !== texte) this.diffuserSession(v, id);
    const visibles = new Set(v.sessions.map((s) => s.id));
    for (const id of avant.fed.keys()) if (!visibles.has(id)) this.o.diffusion.diffuser({ type: 'supprimee', id });
    this.annoncerMasquage(avant.masquees, v);
    for (const [id, texte] of machines) if (avant.machines.get(id) !== texte) this.diffuserMachine(v, id);
    // Une machine qui sort de la vue (nœud révoqué) : l'interface la retire, sinon elle reste listée.
    for (const id of avant.machines.keys()) {
      if (!machines.has(id)) this.o.diffusion.diffuser({ type: 'machine_retiree', id });
    }
  }

  // Une machine qui passe par un nœud (ou qui en revient) : ses copies locales sortent (ou rentrent) de la liste.
  private annoncerMasquage(avant: ReadonlySet<string>, v: VueFederee): void {
    const changees = new Set([...avant, ...v.masquees].filter((m) => avant.has(m) !== v.masquees.has(m)));
    if (changees.size === 0) return;
    for (const s of this.o.registre.sessions(false)) {
      if (!changees.has(s.machine) || v.routage.has(s.id)) continue;
      if (v.masquees.has(s.machine)) this.o.diffusion.diffuser({ type: 'supprimee', id: s.id });
      else this.o.diffusion.diffuser({ type: 'session', session: s });
    }
  }

  private diffuserSession(v: VueFederee, id: string): void {
    const session = v.sessions.find((s) => s.id === id);
    if (session) this.diffuserFederee({ type: 'session', session });
  }

  private diffuserMachine(v: VueFederee, id: string): void {
    const machine = v.machines.find((m) => m.id === id);
    if (machine) this.diffuserFederee({ type: 'machine', machine });
  }

  // La vue fédérée que ce nœud annonce passe le filtre ; une copie locale de la même session, elle, ne passe pas.
  private diffuserFederee(m: MessageClient): void {
    const avant = this.enEmission;
    this.enEmission = true;
    try {
      this.o.diffusion.diffuser(m);
    } finally {
      this.enEmission = avant;
    }
  }

  // Le direct d'une session suivie : l'appli le reçoit comme celui d'une session locale (numéro du nœud qui la tient).
  private surEvenement(membre: string, session: string, e: EvenementFedere): void {
    if (e.seq === undefined || this.vueCourante().routage.get(session) !== membre) return;
    this.diffuserFederee({
      type: 'evenement',
      evenement: { seq: e.seq, sessionId: session, ts: e.ts, evt: e.evt },
    });
  }
}

/** L'étiquette d'ami d'une requête relayée : rien sans ami, sinon son identifiant de charte (jamais un nom). */
function etiquette(ami: string | undefined): { ami?: string } {
  return ami === undefined ? {} : { ami };
}

/** Vrai si l'étiquette peut partir : absente, ou un identifiant de charte (12 hexadécimaux, pas `principal`). */
function etiquetteValide(ami: string | undefined): boolean {
  return ami === undefined || ID_MEMBRE.safeParse(ami).success;
}

function gesteDe(route: RouteDemandee): GesteLocal {
  const requete = route.requete ? { requete: route.requete } : {};
  if (route.portee === 'session') return { geste: route.geste, methode: route.methode, session: route.id, ...requete };
  if (route.portee === 'machine') return { geste: route.geste, methode: route.methode, machine: route.id, ...requete };
  return { geste: route.geste, methode: route.methode, ...requete };
}

/** La requête d'un geste, suivie de ses morceaux quand le corps ne tient pas dans une trame. */
function messagesDuGeste(ref: string, g: GesteLocal, corps: string): MessageChiffre | readonly MessageChiffre[] {
  const requete: Extract<MessageChiffre, { t: 'geste' }> = {
    t: 'geste',
    ref,
    geste: g.geste,
    methode: g.methode,
    ...(g.session ? { session: g.session } : {}),
    ...(g.machine !== undefined ? { machine: g.machine } : {}),
    ...(g.requete ? { requete: g.requete } : {}),
    ...etiquette(g.ami),
  };
  if (corps.length <= TAILLE_MORCEAU_CARACTERES) return corps ? { ...requete, corps } : requete;
  return [...decouper(ref, corps), { ...requete, morceaux: nombreDeMorceaux(corps) }];
}

/** La liste `machines` d'une réponse de `voix/service` d'un pair ; vide si elle n'a pas cette forme. */
function machinesDe(corps: unknown): unknown[] {
  if (corps && typeof corps === 'object' && 'machines' in corps && Array.isArray(corps.machines)) return corps.machines;
  return [];
}

function machineDe(corps: string): string | null {
  try {
    const brut: unknown = JSON.parse(corps);
    if (brut && typeof brut === 'object' && 'machine' in brut && typeof brut.machine === 'string') return brut.machine;
  } catch {
    return null;
  }
  return null;
}

/** La réponse du pair rendue à l'appli : texte (JSON) tel quel, binaire (fichier) décodé de son base64. */
function reponseDuPair(r: Extract<MessageChiffre, { t: 'geste_reponse' }>): Response {
  if (r.codage === 'base64') {
    return new Response(Buffer.from(r.corps, 'base64'), {
      status: r.statut,
      headers: { 'content-type': r.type ?? 'application/octet-stream' },
    });
  }
  return new Response(r.corps, { status: r.statut, headers: { 'content-type': 'application/json' } });
}

function reponseErreur(statut: number, texte: string): Response {
  return new Response(JSON.stringify({ erreur: texte }), {
    status: statut,
    headers: { 'content-type': 'application/json' },
  });
}
