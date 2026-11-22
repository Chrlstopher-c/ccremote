// Responsabilité : les sessions des autres nœuds vues depuis ce nœud — liste fusionnée pour l'appli (sans doublon
// avec les tunnels SSH), annonce de leurs changements sur le flux des clients, et gestes de l'appli relayés au nœud qui tient
// la session (même route, exécutée là-bas). Rien n'entre dans la base : tout vit dans le cache mémoire.
import type { Logger } from 'pino';
import type { MessageClient, VueMachine } from '../../commun/api-clients.ts';
import type { EvenementFedere, MessageChiffre } from '../../commun/federation.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Registre } from '../registre/registre.ts';
import type { CanalNoeud } from './canal.ts';
import { CacheDistant, type SessionDistante } from './distant.ts';
import type { Echanges } from './echanges.ts';
import { estGeste, type GesteDemande, lireGeste } from './gestes.ts';
import { echec, ok, type Resultat } from './resultat.ts';
import { fusionnerVue, type VueFederee } from './vue-federee.ts';

/** Délai d'un geste qui lance du travail chez le nœud (ouvrir, écrire) ; les lectures gardent le délai court. */
const DELAI_GESTE_LONG_MS = 60_000;
const DELAI_GESTE_MS = 20_000;
const TEXTE_HORS_LIGNE = 'machine hors ligne : la session est sur un autre nœud du réseau';
const TEXTE_INDISPONIBLE = 'geste indisponible pour une session d’une autre machine : le faire depuis elle';

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

  constructor(private readonly o: OptionsDistantes) {
    o.cache.observateur = {
      changement: () => this.surChangement(),
      evenement: (membre, session, evt) => this.surEvenement(membre, session, evt),
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

  /** Filtre du flux des clients : les copies SSH d'une machine tenue par un nœud en ligne ne passent pas. */
  laisserPasser(m: MessageClient): boolean {
    const v = this.derniere;
    if (this.enEmission) return true;
    if (!v || v.masquees.size === 0) return true;
    if (m.type === 'session') return v.routage.has(m.session.id) || !v.masquees.has(m.session.machine);
    if (m.type === 'machine') return !v.machinesRoutees.has(m.machine.id);
    return true;
  }

  /** Requête de l'appli (déjà authentifiée) : relayée si elle vise une session ou une machine d'un autre nœud. */
  async intercepter(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (url.pathname === '/api/sessions') return req.method === 'POST' ? this.intercepterOuverture(req) : null;
    const g = lireGeste(url, req.method);
    if (!g) return null;
    const membre = this.vueCourante().routage.get(g.session);
    if (!membre) return null;
    if (!estGeste(g)) return reponseErreur(409, TEXTE_INDISPONIBLE);
    const corps = req.method === 'POST' ? await req.text() : '';
    return this.relayer(membre, g, corps);
  }

  private async intercepterOuverture(req: Request): Promise<Response | null> {
    const corps = await req.clone().text();
    const machine = machineDe(corps);
    const membre = machine ? this.vueCourante().machinesRoutees.get(machine) : undefined;
    if (!membre) return null;
    return this.relayer(membre, { geste: 'ouvrir', methode: 'POST', session: '' }, corps);
  }

  private async relayer(membre: string, g: GesteDemande, corps: string): Promise<Response> {
    const canal = this.o.liaison(membre);
    if (!canal) return reponseErreur(409, TEXTE_HORS_LIGNE);
    const long = g.geste === 'ouvrir' || g.geste === 'messages';
    const reponse = await this.o.echanges.requeter(
      canal,
      (ref) => ({
        t: 'geste',
        ref,
        geste: g.geste,
        methode: g.methode,
        ...(g.session ? { session: g.session } : {}),
        ...(g.requete ? { requete: g.requete } : {}),
        ...(corps ? { corps } : {}),
      }),
      long ? DELAI_GESTE_LONG_MS : DELAI_GESTE_MS,
    );
    if (!reponse || reponse.t !== 'geste_reponse') return reponseErreur(504, 'la machine n’a pas répondu à temps');
    return new Response(reponse.corps, { status: reponse.statut, headers: { 'content-type': 'application/json' } });
  }

  // ---- Gestes nommés (routes /api/federation/sessions/*) ------------------------------------------------------

  async fil(membre: string, session: string): Promise<Resultat<EvenementFedere[]>> {
    const r = await this.requete(membre, (ref) => ({ t: 'fil', ref, session }));
    if (!r.ok) return r;
    return r.valeur.t === 'fil_reponse' ? ok(r.valeur.evenements) : echec(502, 'réponse inattendue');
  }

  filEnMemoire(membre: string, session: string): EvenementFedere[] {
    return this.o.cache.fil(membre, session);
  }

  async ecrire(membre: string, session: string, texte: string): Promise<Resultat<null>> {
    const r = await this.requete(membre, (ref) => ({ t: 'ecrire', ref, session, texte }));
    return r.ok ? ok(null) : r;
  }

  async interrompre(membre: string, session: string): Promise<Resultat<null>> {
    const r = await this.requete(membre, (ref) => ({ t: 'interrompre', ref, session }));
    return r.ok ? ok(null) : r;
  }

  /** Crée une session sur une machine du nœud visé, dans un dossier de cette machine. */
  async ouvrir(
    membre: string,
    machine: string,
    chemin: string,
    message: string,
  ): Promise<Resultat<{ session: string }>> {
    const r = await this.requete(membre, (ref) => ({ t: 'ouvrir', ref, machine, chemin, message }));
    if (!r.ok) return r;
    if (r.valeur.t === 'reponse' && r.valeur.session) return ok({ session: r.valeur.session });
    return echec(502, 'session ouverte sans identifiant');
  }

  private async requete(
    membre: string,
    construire: (ref: string) => MessageChiffre,
  ): Promise<Resultat<MessageChiffre>> {
    const canal = this.o.liaison(membre);
    if (!canal) return echec(409, 'nœud hors ligne ou non relié');
    const reponse = await this.o.echanges.requeter(canal, construire);
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
    if (session) this.o.diffusion.diffuser({ type: 'session', session });
  }

  private diffuserMachine(v: VueFederee, id: string): void {
    const machine = v.machines.find((m) => m.id === id);
    if (!machine) return;
    this.enEmission = true;
    try {
      this.o.diffusion.diffuser({ type: 'machine', machine });
    } finally {
      this.enEmission = false;
    }
  }

  // Le direct d'une session suivie : l'appli le reçoit comme celui d'une session locale (numéro du nœud qui la tient).
  private surEvenement(membre: string, session: string, e: EvenementFedere): void {
    if (e.seq === undefined || this.vueCourante().routage.get(session) !== membre) return;
    this.o.diffusion.diffuser({
      type: 'evenement',
      evenement: { seq: e.seq, sessionId: session, ts: e.ts, evt: e.evt },
    });
  }
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

function reponseErreur(statut: number, texte: string): Response {
  return new Response(JSON.stringify({ erreur: texte }), {
    status: statut,
    headers: { 'content-type': 'application/json' },
  });
}
