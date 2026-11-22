// Responsabilité : ajouter une machine au réseau Lanterne depuis ce nœud — par SSH : dépôt du moteur, installation du
// nœud (bascule du poste existant, même identifiant de machine), rattachement à l'aiguilleur avec un code à usage
// unique, demande d'appairage vers ce nœud ; puis ici : empreintes comparées (celle lue par SSH contre celle venue par
// l'aiguilleur), accord de Chris, lien chiffré, reprise des épinglages. Un ajout à la fois, état en mémoire.
import type { Logger } from 'pino';
import type { CorpsAjoutNoeud, EtapeAjout, RepriseAjout, VueAjout } from '../../commun/ajout-noeud.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { EtatFederation } from '../federation/etat-federation.ts';
import { urlAiguilleurValide } from '../federation/aiguilleur-http.ts';
import { echec, ok, type Resultat } from '../federation/resultat.ts';
import type { ConnexionSsh, Ssh } from '../machines/ssh.ts';
import type { SourcesNoeud } from './binaire.ts';
import { appliquerReprise, type Epingler, planReprise } from './reprise.ts';
import {
  commandeDepotBinaire,
  commandeDepotCode,
  commandeRetourArriere,
  commandeSonde,
  scriptNoeud,
} from './script-noeud.ts';
import { etapeDistante, lireSortie, messageEchec, type SortieNoeud } from './sortie-noeud.ts';

export interface PortFederationAjout {
  etat(): Promise<EtatFederation>;
  decider(id: string, accord: boolean): boolean;
  revoquer(membre: string): Resultat<null>;
  /** Sessions annoncées par un nœud apparié (dernier instantané). */
  sessionsDe(membre: string): readonly ResumeSession[];
}

export interface DelaisAjout {
  readonly demandeMs: number;
  readonly accordMs: number;
  readonly lienMs: number;
  readonly instantaneMs: number;
  readonly pasMs: number;
}

export interface DependancesAjout {
  readonly ssh: Pick<Ssh, 'executer'>;
  /** Connexion SSH d'une machine déjà configurée (Paramètres › Machines), ou null. */
  readonly connexionDe: (machine: string) => ConnexionSsh | null;
  readonly federation: PortFederationAjout;
  readonly creerCode: () => Promise<Resultat<{ readonly code: string }>>;
  readonly sources: () => SourcesNoeud;
  /** Toutes les fiches de ce relais, archivées comprises. */
  readonly sessionsLocales: () => readonly ResumeSession[];
  readonly epingler: Epingler;
  readonly signaler: () => void;
  readonly journal: Logger;
  readonly delais?: Partial<DelaisAjout>;
}

const DELAIS: DelaisAjout = { demandeMs: 60_000, accordMs: 600_000, lienMs: 60_000, instantaneMs: 20_000, pasMs: 500 };
const CODE_SSH_INJOIGNABLE = 255;

interface Suivi {
  vue: VueAjout;
  readonly connexion: ConnexionSsh;
  demande: string | null;
}

class EchecAjout extends Error {}

export class AjoutNoeud {
  private readonly suivis = new Map<string, Suivi>();
  private enCours: string | null = null;
  private readonly delais: DelaisAjout;

  constructor(private readonly d: DependancesAjout) {
    this.delais = { ...DELAIS, ...d.delais };
  }

  liste(): VueAjout[] {
    return [...this.suivis.values()].map((s) => s.vue);
  }

  /** Démarre l'ajout (réponse immédiate) ; l'avancement se lit dans `liste()`. */
  async lancer(c: CorpsAjoutNoeud): Promise<Resultat<VueAjout>> {
    if (this.enCours) return echec(409, `un ajout est déjà en cours : ${this.enCours}`);
    const connexion = c.ssh ?? this.d.connexionDe(c.machine);
    if (!connexion) return echec(400, 'accès SSH inconnu : configure la machine ou donne son accès SSH');
    const etat = await this.d.federation.etat();
    const a = etat.aiguilleur;
    if (!a?.relie) return echec(409, 'cette machine n’est pas reliée à l’aiguilleur');
    const url = urlAiguilleurValide(c.aiguilleur ?? a.url);
    if (!url) return echec(400, 'adresse de l’aiguilleur invalide');
    const suivi: Suivi = { vue: vueNeuve(c, !c.ssh), connexion, demande: null };
    this.suivis.set(c.machine, suivi);
    this.enCours = c.machine;
    this.d.signaler();
    void this.derouler(suivi, { url, pair: a.id, empreinteLocale: etat.empreinteLocale }).finally(() => {
      this.enCours = null;
    });
    return ok(suivi.vue);
  }

  /** L'accord de Chris : seulement si les empreintes concordent, sur la demande de ce nœud-là. */
  accepter(machine: string): Resultat<null> {
    const s = this.suivis.get(machine);
    if (s?.vue.etat !== 'accord_attendu' || !s.demande) return echec(409, 'aucun accord attendu pour cette machine');
    if (s.vue.concordance !== 'identique') return echec(409, 'empreintes non concordantes : accord refusé');
    return this.d.federation.decider(s.demande, true) ? ok(null) : echec(409, 'demande expirée');
  }

  /** Retour arrière : le nœud s'arrête, le poste d'origine reprend ; la machine est révoquée ici. */
  async retour(machine: string): Promise<Resultat<null>> {
    if (this.enCours === machine) return echec(409, 'ajout en cours : attends sa fin');
    const s = this.suivis.get(machine);
    const connexion = s?.connexion ?? this.d.connexionDe(machine);
    if (!connexion) return echec(404, 'machine inconnue');
    const r = await this.d.ssh.executer(connexion, commandeRetourArriere(), null, 120_000);
    this.d.journal.info({ machine, code: r.code }, 'ajout de nœud : retour arrière');
    if (r.code !== 0) return echec(502, messageEchec(r.sortie, r.erreurs, connexion.hote));
    const membre = s?.vue.membre;
    if (membre && (await this.d.federation.etat()).noeuds.some((n) => n.id === membre)) {
      this.d.federation.revoquer(membre);
    }
    if (s) this.maj(s, { etat: 'retire', message: 'nœud arrêté, poste d’origine rétabli' });
    return ok(null);
  }

  private async derouler(s: Suivi, ctx: Contexte): Promise<void> {
    try {
      const sortie = await this.installer(s, ctx);
      if (!sortie.dejaAppaire) await this.comparer(s, sortie, ctx);
      await this.attendreLien(s);
      await this.reprendre(s);
    } catch (e) {
      const message = e instanceof EchecAjout ? e.message : 'ajout impossible';
      if (!(e instanceof EchecAjout)) this.d.journal.error({ err: e, machine: s.vue.machine }, 'ajout de nœud');
      this.maj(s, { etat: 'echec', message });
    }
  }

  private async installer(s: Suivi, ctx: Contexte): Promise<SortieNoeud> {
    const sonde = await this.d.ssh.executer(s.connexion, commandeSonde(), null, 20_000);
    if (sonde.code === CODE_SSH_INJOIGNABLE || sonde.code < 0) throw new EchecAjout('machine injoignable par SSH');
    const code = lireSortie(sonde.sortie).relie ? null : await this.code(s);
    this.etape(s, 'envoi');
    const sha = await this.deposer(s);
    this.etape(s, 'installation');
    const { machine, nom } = s.vue;
    const script = scriptNoeud({ sha, machine, nom, aiguilleur: ctx.url, code, pair: ctx.pair });
    const r = await this.d.ssh.executer(s.connexion, 'bash -s', new TextEncoder().encode(script), 900_000, (l) =>
      this.ligne(s, l),
    );
    const sortie = lireSortie(r.sortie);
    this.d.journal.info({ machine: s.vue.machine, code: r.code, membre: sortie.membre }, 'ajout de nœud : script');
    if (r.code !== 0 || !sortie.fin || !sortie.membre) {
      throw new EchecAjout(messageEchec(r.sortie, r.erreurs, s.connexion.hote));
    }
    this.maj(s, {
      membre: sortie.membre,
      empreinteSsh: sortie.empreinte,
      empreinteVueParLeNoeud: sortie.empreintePair,
    });
    return sortie;
  }

  private async code(s: Suivi): Promise<string> {
    this.etape(s, 'code');
    const r = await this.d.creerCode();
    if (!r.ok) throw new EchecAjout(`code d’appairage : ${r.raison}`);
    return r.valeur.code;
  }

  private async deposer(s: Suivi): Promise<string> {
    let sources: SourcesNoeud;
    try {
      sources = this.d.sources();
    } catch (e) {
      throw new EchecAjout(e instanceof Error ? e.message : 'sources du nœud illisibles');
    }
    const b = await this.d.ssh.executer(s.connexion, commandeDepotBinaire(), sources.binaireGz, 600_000);
    const sha = lireSortie(b.sortie).sha;
    if (b.code !== 0 || !sha) throw new EchecAjout(messageEchec(b.sortie, b.erreurs, s.connexion.hote));
    const c = await this.d.ssh.executer(s.connexion, commandeDepotCode(sha), sources.codePoste, 120_000);
    if (c.code !== 0) throw new EchecAjout(messageEchec(c.sortie, c.erreurs, s.connexion.hote));
    return sha;
  }

  private ligne(s: Suivi, ligne: string): void {
    const etape = etapeDistante(ligne);
    if (etape === 'bascule') this.maj(s, { bascule: true });
    if (etape === 'appairage' || etape === 'aiguilleur') return this.etape(s, 'appairage', etape);
    if (etape) this.maj(s, { message: etape });
  }

  // Les deux empreintes doivent concorder : celle du nœud lue par SSH = celle que la demande apporte par l'aiguilleur,
  // et celle de ce nœud vue par le nouveau = la vraie. Sinon un intermédiaire est possible : la demande est refusée.
  private async comparer(s: Suivi, sortie: SortieNoeud, ctx: Contexte): Promise<void> {
    const demande = await this.attendre(this.delais.demandeMs, async () =>
      (await this.d.federation.etat()).demandes.find((d) => d.membre === sortie.membre),
    );
    if (!demande) throw new EchecAjout('la demande d’appairage du nœud n’est pas arrivée');
    const identique = demande.empreinte === sortie.empreinte && sortie.empreintePair === ctx.empreinteLocale;
    s.demande = demande.id;
    this.maj(s, { empreinteDemande: demande.empreinte, concordance: identique ? 'identique' : 'differente' });
    if (!identique) {
      this.d.federation.decider(demande.id, false);
      this.d.journal.warn({ machine: s.vue.machine }, 'ajout de nœud : empreintes différentes, demande refusée');
      throw new EchecAjout('empreintes différentes entre SSH et l’aiguilleur : appairage refusé');
    }
    this.maj(s, { etape: 'accord', etat: 'accord_attendu', message: null });
    let disparue = 0; // la demande tranchée disparaît avant que le pair soit mémorisé : quelques tours de grâce
    const apparie = await this.attendre(this.delais.accordMs, async () => {
      const e = await this.d.federation.etat();
      if (e.noeuds.some((n) => n.id === sortie.membre)) return true;
      if (e.demandes.some((d) => d.id === demande.id)) return undefined;
      disparue += 1;
      return disparue > 6 ? false : undefined;
    });
    if (!apparie) throw new EchecAjout('appairage refusé ou expiré');
  }

  private async attendreLien(s: Suivi): Promise<void> {
    this.maj(s, { etape: 'lien', etat: 'en_cours', message: null });
    const ouvert = await this.attendre(this.delais.lienMs, async () =>
      (await this.d.federation.etat()).noeuds.some((n) => n.id === s.vue.membre && n.liaisonOuverte) || undefined,
    );
    if (!ouvert) throw new EchecAjout('le lien chiffré ne s’est pas ouvert');
  }

  private async reprendre(s: Suivi): Promise<void> {
    this.etape(s, 'reprise');
    const membre = s.vue.membre ?? '';
    await this.attendre(this.delais.instantaneMs, async () =>
      this.d.federation.sessionsDe(membre).length > 0 || undefined,
    );
    const plan = planReprise(this.d.sessionsLocales(), this.d.federation.sessionsDe(membre), s.vue.machine);
    const reprise = await appliquerReprise(plan, this.d.epingler);
    this.d.journal.info({ machine: s.vue.machine, ...reprise }, 'ajout de nœud : reprise d’attribution');
    this.maj(s, { etat: 'fini', reprise, message: resumeReprise(reprise) });
  }

  private async attendre<T>(delaiMs: number, lire: () => Promise<T | undefined>): Promise<T | undefined> {
    const echeance = Date.now() + delaiMs;
    for (;;) {
      const v = await lire();
      if (v !== undefined || Date.now() >= echeance) return v;
      await Bun.sleep(this.delais.pasMs);
    }
  }

  private etape(s: Suivi, etape: EtapeAjout, message: string | null = null): void {
    this.maj(s, { etape, message });
  }

  private maj(s: Suivi, patch: Partial<VueAjout>): void {
    s.vue = { ...s.vue, ...patch, majLe: new Date().toISOString() };
    this.d.signaler();
  }
}

interface Contexte {
  readonly url: string;
  readonly pair: string;
  readonly empreinteLocale: string;
}

function vueNeuve(c: CorpsAjoutNoeud, bascule: boolean): VueAjout {
  return {
    machine: c.machine,
    nom: c.nom,
    etape: 'verification',
    etat: 'en_cours',
    message: null,
    bascule,
    membre: null,
    empreinteSsh: null,
    empreinteVueParLeNoeud: null,
    empreinteDemande: null,
    concordance: null,
    reprise: null,
    majLe: new Date().toISOString(),
  };
}

export function resumeReprise(r: RepriseAjout): string {
  const morceaux = [`${r.retrouvees} session(s) retrouvée(s) sous la même machine`];
  if (r.epinglees > 0) morceaux.push(`${r.epinglees} épinglage(s) reporté(s)`);
  if (r.archivees > 0) morceaux.push(`${r.archivees} archivée(s) gardée(s) ici`);
  if (r.absentes > 0) morceaux.push(`${r.absentes} absente(s) du nœud`);
  return morceaux.join(' · ');
}
