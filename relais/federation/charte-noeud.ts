// Responsabilité : la charte signée du réseau côté nœud — la tient (relue et vérifiée au démarrage), l'adopte
// d'un pair apparié de mêmes propriétaires ou d'une édition de chef, la relaie, applique ses conséquences
// (révocations), répond à l'appairage et fonde le réseau du parc pour un nœud embarqué. Aucun lien ni requête ici :
// Federation et les échanges appliquent. Les opérations passent par une file (une seule à la fois).
import type { Logger } from 'pino';
import {
  ajouterMembre,
  autorise as droitAutorise,
  inviterMembre,
  type Charte,
  type CharteSignee,
  creerCharte,
  type Edition,
  estChef as chefDans,
  lireCharte,
  type MembreCharte,
  type MembreSansDroits,
  membreDe,
  type RequeteDroit,
  repriseCede,
  repriseDuParc,
  type Sorte,
  repriseLEmporte,
  signerCharte,
  TOUS_DROITS,
  verifierCharte,
} from '../../commun/charte.ts';
import { exporterIdentitePublique, type Identite } from '../../commun/chiffrement/identite.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import { autoriseAmi as droitAmiAutorise } from '../../commun/charte-amis.ts';
import type { VerdictSource } from './admissions.ts';
import type { PresentationDistante } from './canal.ts';
import type { ReglagesInvite } from '../../commun/invites.ts';
import { maintenant, messageDe, reseauNeuf, sansDroits } from './charte-noeud-outils.ts';
import { echec, ok, type Resultat } from './resultat.ts';
import { retirerDeLAiguilleur } from './retrait-aiguilleur.ts';
import type { PairFederee, SecretsNoeud } from './secrets.ts';

/** Un lien chiffré vers un nœud pair : seul ce qu'il faut pour y envoyer un message (CanalNoeud en est un). */
export interface LienCharte {
  readonly membre: string;
  envoyer(message: MessageChiffre): boolean;
}

/** Ce que la charte attend de son hôte (Federation) : identités, pairs, liens, révocations, signal de changement. */
export interface PortCharte {
  readonly journal: Logger;
  readonly secrets: SecretsNoeud;
  /** Nœud embarqué dans l'appli (non autonome) : seul lui peut fonder le réseau du parc (migration). */
  readonly peutReprendre: boolean;
  moi(): string | null;
  nomLocal(): string;
  identite(): Promise<Identite>;
  pairs(): readonly PairFederee[];
  liensNoeuds(): readonly LienCharte[];
  revoquer(membre: string): void;
  signaler(): void;
  /** Retrait de l'annuaire de l'aiguilleur d'un membre sorti de la charte (défaut : la route de l'aiguilleur). */
  retirerDeLAiguilleur?(membre: string): void;
  /** Réglages d'invité préparés pour ce membre (machine invitée avant son appairage), ou null. */
  invitePrevue?(membre: string): ReglagesInvite | null;
}

/** Suite d'un appairage entrant : admis d'office, demandé à un chef, ou refusé (non-chef). */
export type SuiteAppairage = 'accord' | 'demande' | 'refus';

type Fonction = (c: Charte, moi: string, le: string) => Edition;

/** Une charte proposée dont l'auteur ou la signature ne tient pas : interdite ; le reste, un conflit (409). */
function statutRefus(motif: string): number {
  return motif === 'signataire-non-chef' || motif === 'signature' ? 403 : 409;
}
type VerdictNoeud = { readonly ok: true; readonly charte: Charte } | { readonly ok: false; readonly motif: string };

export class CharteNoeud {
  private courante: Charte | null = null;
  private signeeCourante: CharteSignee | null = null;
  private file: Promise<unknown> = Promise.resolve();

  constructor(private readonly port: PortCharte) {}

  /** Relit la charte gardée et la vérifie à nouveau : une charte falsifiée ou illisible est ignorée. */
  demarrer(): Promise<void> {
    return this.sur(this.enfiler(() => this.charger()), 'charte locale : lecture en échec');
  }

  charte(): Charte | null {
    return this.courante;
  }

  moi(): string | null {
    return this.port.moi();
  }

  /** La charte signée courante, telle que reçue ou adoptée (null sans charte). */
  signee(): CharteSignee | null {
    return this.signeeCourante;
  }

  /** Ce nœud est-il chef du réseau ? Sans charte : non. */
  chefLocal(): boolean {
    const moi = this.port.moi();
    return moi !== null && chefDans(this.courante, moi);
  }

  estChef(membre: string): boolean {
    return chefDans(this.courante, membre);
  }

  /** Sans charte, tout est permis entre nœuds de mêmes propriétaires ; avec une charte, les droits du membre. */
  autorise(membre: string, requete: RequeteDroit): boolean {
    return droitAutorise(this.courante, membre, requete);
  }

  /** Droits d'un ami du duo sur CETTE machine, vérifiés ici d'après la charte courante (fermé sans charte). */
  autoriseAmi(ami: string, requete: RequeteDroit): boolean {
    const moi = this.port.moi();
    return moi !== null && droitAmiAutorise(this.courante, ami, moi, requete);
  }

  compteDeMoi(): string | null {
    const moi = this.port.moi();
    return moi === null ? null : (membreDe(this.courante, moi)?.compte ?? null);
  }

  /**
   * Appairage entrant : un membre reconnu (même identité, même genre) est admis ; un autre va à un chef. Sur un
   * nœud non chef, la demande n'a de sens que si un téléphone chef est relié ici (il la tranche).
   */
  suiteAppairage(presentation: PresentationDistante, chefAppareilRelie = false): SuiteAppairage {
    if (this.courante === null) return 'demande';
    if (this.membreReconnu(presentation)) return 'accord';
    return this.chefLocal() || chefAppareilRelie ? 'demande' : 'refus';
  }

  /** Une charte signée proposée par un téléphone chef : vérifiée contre la courante, adoptée et relayée. */
  proposer(signee: CharteSignee): Promise<Resultat<Charte>> {
    return this.enfiler(async () => {
      const actuelle = this.courante;
      if (actuelle === null) return echec(409, 'aucun réseau sur ce nœud');
      const verdict = await verifierCharte(actuelle, signee);
      if (!verdict.ok) return echec(statutRefus(verdict.motif), verdict.motif);
      const adoptee = await this.adopter(verdict.charte, signee, null);
      return adoptee ? ok(verdict.charte) : echec(500, 'charte non sauvegardée');
    });
  }

  private membreReconnu(presentation: PresentationDistante): boolean {
    const appareil = presentation.genre === 'appareil';
    return (this.courante?.membres ?? []).some(
      (m) => m.identite === presentation.identite && (m.sorte === 'telephone') === appareil,
    );
  }

  /** Un appairage accepté par Chris : sous une charte, le membre y entre (signé par ce chef), ou y est déjà. */
  admettre(membre: string, presentation: PresentationDistante, sorteNoeud: Sorte = 'serveur'): Promise<boolean> {
    return this.enfiler(() => this.admettreSerie(membre, presentation, sorteNoeud)).catch((erreur: unknown) => {
      this.port.journal.error({ err: erreur, membre }, 'admission : en échec');
      return false;
    });
  }

  private async admettreSerie(membre: string, presentation: PresentationDistante, sorteNoeud: Sorte): Promise<boolean> {
    if (this.courante === null) return true;
    const existant = membreDe(this.courante, membre);
    if (existant !== null) return existant.identite === presentation.identite;
    const nouveau: MembreCharte = {
      id: membre,
      nom: presentation.nom,
      sorte: presentation.genre === 'appareil' ? 'telephone' : sorteNoeud,
      identite: presentation.identite,
      droits: { ...TOUS_DROITS },
      compte: null,
    };
    const prevu = this.port.invitePrevue?.(membre) ?? null;
    const r = await this.editerSerie((c, moi, le) =>
      prevu === null
        ? ajouterMembre(c, moi, nouveau, le)
        : inviterMembre(c, moi, { id: membre, nom: presentation.nom, identite: presentation.identite }, prevu, le),
    );
    if (!r.ok) this.port.journal.warn({ membre, raison: r.raison }, 'appairage : membre non ajouté à la charte');
    return r.ok;
  }

  /** Les admissions d'appareils reçues ne valent que pour les membres de la charte, avec la même identité. */
  filtrerAdmissions<T extends { readonly id: string; readonly identite: string }>(liste: readonly T[]): T[] {
    const c = this.courante;
    if (c === null) return [...liste];
    return liste.filter((a) => membreDe(c, a.id)?.identite === a.identite);
  }

  /** Une charte reçue d'un pair : seulement d'un nœud apparié de mêmes propriétaires (`source`). */
  recevoir(membre: string, signee: CharteSignee, source: VerdictSource): Promise<void> {
    if (source !== 'accepte') {
      this.port.journal.info({ membre, source }, 'charte ignorée : pair hors de nos nœuds');
      return Promise.resolve();
    }
    return this.sur(this.enfiler(() => this.traiterRecue(membre, signee)), 'charte reçue : traitement en échec');
  }

  /** Édition par un chef : la fonction rend la version suivante (non signée), signée ici avec la clé du nœud. */
  editer(fonction: Fonction): Promise<Resultat<Charte>> {
    return this.enfiler(() => this.editerSerie(fonction));
  }

  /** Création du réseau par ce nœud (« Créer mon réseau ») : seulement s'il n'en a pas. */
  creer(nom: string): Promise<Resultat<Charte>> {
    return this.enfiler(async () => {
      const moi = this.port.moi();
      if (this.courante !== null) return echec(409, 'un réseau existe déjà sur ce nœud');
      if (moi === null) return echec(409, 'aucun aiguilleur : ce nœud n’a pas d’identifiant');
      const charte = creerCharte({ reseau: reseauNeuf(), nom, moi: await this.membreMoi(moi), le: maintenant() });
      return this.signerEtAdopter(charte, null);
    });
  }

  /** Migration : nœud embarqué, relié, sans charte, apparié à un nœud : il fonde le réseau du parc. */
  essayerReprise(): Promise<void> {
    if (!this.port.peutReprendre) return Promise.resolve();
    return this.sur(this.enfiler(() => this.reprendre()), 'reprise du parc : en échec');
  }

  /** À l'ouverture d'un lien : la charte courante part à un nœud pair (jamais à un appareil). */
  envoyerA(lien: LienCharte): void {
    const signee = this.signeeCourante;
    if (signee === null || !this.port.pairs().some((p) => p.id === lien.membre && p.genre === 'noeud')) return;
    lien.envoyer(messageDe(signee));
  }

  private sur(tache: Promise<unknown>, quoi: string): Promise<void> {
    return tache.then(
      () => undefined,
      (erreur: unknown) => this.port.journal.error({ err: erreur }, quoi),
    );
  }

  private enfiler<T>(tache: () => Promise<T>): Promise<T> {
    const suite = this.file.then(tache);
    this.file = suite.catch(() => undefined);
    return suite;
  }

  private async charger(): Promise<void> {
    const lue = this.port.secrets.lireCharte();
    if (lue === null) return;
    const verdict = await verifierCharte(null, lue);
    if (!verdict.ok) return this.port.journal.error({ motif: verdict.motif }, 'charte locale refusée : ignorée');
    this.courante = verdict.charte;
    this.signeeCourante = lue;
  }

  private async traiterRecue(membre: string, signee: CharteSignee): Promise<void> {
    const verdict = await this.verifierRecue(signee);
    if (verdict.ok) {
      await this.adopter(verdict.charte, signee, membre);
    } else if (verdict.motif === 'ancienne') {
      this.port.journal.info({ membre, motif: verdict.motif }, 'charte reçue refusée');
    } else {
      this.port.journal.warn({ membre, motif: verdict.motif }, 'charte reçue refusée');
    }
  }

  private async verifierRecue(signee: CharteSignee): Promise<VerdictNoeud> {
    const actuelle = this.courante;
    if (actuelle === null) return this.genese(signee);
    const verdict = await verifierCharte(actuelle, signee);
    if (verdict.ok || verdict.motif !== 'autre-reseau') return verdict;
    const proposee = lireCharte(signee.texte);
    const moi = this.port.moi();
    if (proposee === null || moi === null) return verdict;
    const cede = repriseLEmporte(actuelle, proposee) || repriseCede(actuelle, proposee, moi);
    return cede ? this.genese(signee) : verdict;
  }

  /** Première charte d'un nœud : signée par un chef de son propre contenu, et ce nœud y figure. */
  private async genese(signee: CharteSignee): Promise<VerdictNoeud> {
    const verdict = await verifierCharte(null, signee);
    if (!verdict.ok) return verdict;
    const moi = this.port.moi();
    return moi !== null && membreDe(verdict.charte, moi) !== null ? verdict : { ok: false, motif: 'non-membre' };
  }

  /** Adopte une charte vérifiée : sauvée, signalée, relayée aux autres nœuds, puis ses conséquences. */
  private async adopter(charte: Charte, signee: CharteSignee, depuis: string | null): Promise<boolean> {
    const ancienne = this.courante;
    try {
      this.port.secrets.ecrireCharte(signee);
    } catch (erreur) {
      this.port.journal.error({ err: erreur }, 'charte non sauvegardée : non adoptée');
      return false;
    }
    this.courante = charte;
    this.signeeCourante = signee;
    this.port.signaler();
    for (const lien of this.port.liensNoeuds()) if (lien.membre !== depuis) lien.envoyer(messageDe(signee));
    // Changer de réseau (reprise qui cède) ne révoque personne : l'ancienne charte n'engageait que ce nœud.
    if (ancienne !== null && ancienne.reseau === charte.reseau) this.revoquerSortis(ancienne, charte);
    this.port.journal.info({ version: charte.version, origine: charte.origine }, 'charte adoptée');
    return true;
  }

  /** Un pair membre de l'ancienne charte et absent de la nouvelle est révoqué, comme une révocation manuelle. */
  private revoquerSortis(ancienne: Charte, nouvelle: Charte): void {
    const moi = this.port.moi();
    const restants = new Set(nouvelle.membres.map((m) => m.id));
    const pairs = new Set(this.port.pairs().map((p) => p.id));
    for (const m of ancienne.membres) {
      if (m.id !== moi && !restants.has(m.id) && pairs.has(m.id)) this.port.revoquer(m.id);
    }
  }

  private async editerSerie(fonction: Fonction): Promise<Resultat<Charte>> {
    const actuelle = this.courante;
    const moi = this.port.moi();
    if (actuelle === null || moi === null) return echec(409, 'aucun réseau sur ce nœud');
    if (!chefDans(actuelle, moi)) return echec(403, 'ce nœud n’est pas chef du réseau');
    const edition = fonction(actuelle, moi, maintenant());
    if (!edition.ok) return echec(409, edition.raison);
    const r = await this.signerEtAdopter(edition.charte, actuelle);
    if (r.ok) this.retirerSortis(actuelle, r.valeur, moi);
    return r;
  }

  /** Les membres qu'une édition de ce chef a sortis de la charte quittent aussi l'annuaire de l'aiguilleur. */
  private retirerSortis(ancienne: Charte, nouvelle: Charte, moi: string): void {
    const restants = new Set(nouvelle.membres.map((m) => m.id));
    for (const m of ancienne.membres) {
      if (m.id === moi || restants.has(m.id)) continue;
      if (this.port.retirerDeLAiguilleur) this.port.retirerDeLAiguilleur(m.id);
      else void retirerDeLAiguilleur(this.port.secrets, this.port.journal, m.id);
    }
  }

  /** Signe avec la clé du nœud, vérifie (contre la précédente, ou seule à la genèse), puis adopte. */
  private async signerEtAdopter(charte: Charte, precedente: Charte | null): Promise<Resultat<Charte>> {
    const signee = await signerCharte(charte, (await this.port.identite()).signaturePrivee);
    const verdict = await verifierCharte(precedente, signee);
    if (!verdict.ok) return echec(500, `charte refusée par sa propre vérification : ${verdict.motif}`);
    const adoptee = await this.adopter(verdict.charte, signee, null);
    return adoptee ? ok(verdict.charte) : echec(500, 'charte non sauvegardée');
  }

  private async reprendre(): Promise<void> {
    const moi = this.port.moi();
    const pairs = this.port.pairs();
    if (this.courante !== null || moi === null || !pairs.some((p) => p.genre === 'noeud')) return;
    const charte = repriseDuParc({
      reseau: reseauNeuf(),
      nom: 'Mon réseau',
      moi: await this.membreMoi(moi),
      noeuds: pairs.filter((p) => p.genre === 'noeud').map(sansDroits),
      appareils: pairs.filter((p) => p.genre === 'appareil').map(sansDroits),
      le: maintenant(),
    });
    const r = await this.signerEtAdopter(charte, null);
    if (!r.ok) this.port.journal.error({ raison: r.raison }, 'reprise du parc : réseau non fondé');
  }

  private async membreMoi(moi: string): Promise<MembreSansDroits> {
    const identite = exporterIdentitePublique((await this.port.identite()).publique);
    return { id: moi, nom: this.port.nomLocal(), identite };
  }
}
