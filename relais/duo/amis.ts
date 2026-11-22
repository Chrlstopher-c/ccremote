// Responsabilité : la liste d'amis du mode duo — un emplacement par ami (une instance Duo : sa paire, ses droits, ses
// demandes, son journal). Le premier ami est le duo d'avant (lien direct, base du relais) ; les amis ajoutés
// vivent dans leur dossier, en aiguilleur seulement. Route les appels vers l'emplacement concerné ; le lien de
// l'aiguilleur est partagé entre tous (amis-aiguilleur.ts), un emplacement suspendu n'y figure pas.
import type { Database } from 'bun:sqlite';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { HandlerDuoAiguilleur, PortAiguilleurDuo } from '../../commun/duo-aiguilleur.ts';
import { type AmiDuo, ID_AMI_PRINCIPAL } from '../../commun/duo-amis.ts';
import { DROITS_NOUVEL_AMI, type EtatDuo, PREFIXE_MODULE_DUO } from '../../commun/duo.ts';
import type { ReponseServeur, RequeteServeur } from '../../commun/modules.ts';
import type { PieceJointe } from '../../commun/presentation.ts';
import { MultiplexeurAiguilleur } from './amis-aiguilleur.ts';
import { type EntreeIndex, IndexAmis } from './amis-index.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Duo } from './duo.ts';
import type { OptionsDuo } from './options-duo.ts';
import { echec, ok, type Resultat } from './resultat.ts';


interface Emplacement {
  readonly id: string;
  readonly duo: Duo;
}

export class AmisDuo {
  readonly principal: Duo;
  private readonly emplacements = new Map<string, Duo>();
  private readonly entrees = new Map<string, EntreeIndex>();
  private readonly bases = new Map<string, Database>();
  private readonly index: IndexAmis;
  private multiplexeur: MultiplexeurAiguilleur | null = null;

  constructor(private readonly options: OptionsDuo) {
    this.principal = new Duo(options);
    this.emplacements.set(ID_AMI_PRINCIPAL, this.principal);
    this.index = new IndexAmis(options.dossierSecrets, options.journal);
    for (const entree of this.index.lire()) {
      this.entrees.set(entree.id, entree);
      if (entree.id !== ID_AMI_PRINCIPAL) this.ouvrirAmi(entree.id);
    }
  }

  // ---- Cycle de vie : démarrage, arrêt, aiguilleur partagé --------------------------------------------------------

  demarrer(): void {
    for (const [id, duo] of this.emplacements) {
      if (!this.suspendu(id)) duo.demarrer();
    }
  }

  arreter(): void {
    for (const duo of this.emplacements.values()) duo.arreter();
  }

  /** Un seul lien de la fédération pour tous les amis : le multiplexeur le répartit entre les emplacements. */
  brancherAiguilleur(port: PortAiguilleurDuo): HandlerDuoAiguilleur {
    this.multiplexeur = new MultiplexeurAiguilleur(port, this.options.journal);
    for (const [id, duo] of this.emplacements) {
      if (!this.suspendu(id)) this.brancher(id, duo);
    }
    return this.multiplexeur;
  }

  // ---- Liste : ajouter, retirer, suspendre ------------------------------------------------------------------------

  /** Un emplacement sans paire est réutilisé (le principal d'abord) ; sinon un ami neuf est créé. Rend son id. */
  ajouter(): Resultat<string> {
    const libre = this.emplacementLibre();
    if (libre === null) return this.creerAmi();
    libre.duo.majDroits(DROITS_NOUVEL_AMI);
    return ok(libre.id);
  }

  /** Révocation de la paire ; un ami ajouté voit en plus son emplacement, sa base et son dossier effacés. */
  retirer(id: string): Resultat<AmiDuo[]> {
    const duo = this.emplacements.get(id);
    if (duo === undefined) return echec(404, 'ami introuvable');
    duo.revoquer();
    if (id === ID_AMI_PRINCIPAL) return this.fini();
    const avant = this.entrees.get(id);
    this.entrees.delete(id);
    if (!this.persister()) {
      if (avant !== undefined) this.entrees.set(id, avant);
      return echec(500, 'index des amis non écrit');
    }
    this.debrancher(id, duo);
    this.supprimerEmplacement(id);
    return this.fini();
  }

  /** Suspendre arrête l'emplacement (plus aucun canal) ; la paire reste. Reprendre le redémarre et le rebranche. */
  suspendre(id: string, suspendu: boolean): Resultat<AmiDuo[]> {
    const duo = this.emplacements.get(id);
    if (duo === undefined) return echec(404, 'ami introuvable');
    if (this.suspendu(id) === suspendu) return ok(this.lister());
    const creeLe = this.entrees.get(id)?.creeLe ?? this.maintenant();
    if (!this.changerEntree({ id, creeLe, suspendu })) return echec(500, 'index des amis non écrit');
    if (suspendu) {
      this.debrancher(id, duo);
    } else {
      duo.demarrer();
      this.brancher(id, duo);
    }
    return this.fini();
  }

  lister(): AmiDuo[] {
    return [...this.emplacements].map(([id, duo]) => this.decrireDuo(id, duo));
  }

  decrire(id: string): AmiDuo | null {
    const duo = this.emplacements.get(id);
    return duo === undefined ? null : this.decrireDuo(id, duo);
  }

  instance(id: string): Duo | null {
    return this.emplacements.get(id) ?? null;
  }

  tous(): Duo[] {
    return [...this.emplacements.values()];
  }

  /** Le nom de ce nœud est le même pour tous les amis. */
  majNom(nom: string): EtatDuo {
    for (const duo of this.emplacements.values()) duo.majNom(nom);
    return this.principal.etat();
  }

  // ---- Pont vers les sessions du pair et vers ses modules : routé par le pair concerné ---------------------------

  ecrireAPair(
    session: string,
    texte: string,
    pieces: readonly PieceJointe[],
    relayeDe?: { readonly session: string; readonly titre: string },
  ): Promise<Resultat<string | null>> {
    const r = this.parSession(session);
    return r.ok ? r.valeur.ecrireAPair(session, texte, pieces, relayeDe) : Promise.resolve(r);
  }

  interrompreAPair(session: string): Promise<Resultat<string | null>> {
    const r = this.parSession(session);
    return r.ok ? r.valeur.interrompreAPair(session) : Promise.resolve(r);
  }

  /** Le module porte son pair dans sa machine (`duo:<utilisateur>`). */
  async serveurDuPair(id: string, requete: RequeteServeur): Promise<Resultat<ReponseServeur>> {
    const machine = this.options.registre.modules.obtenir(id)?.machine ?? '';
    if (!machine.startsWith(PREFIXE_MODULE_DUO)) return echec(503, 'module du pair introuvable');
    const r = this.parPair(machine.slice(PREFIXE_MODULE_DUO.length));
    return r.ok ? r.valeur.avances.serveurDuPair(id, requete) : r;
  }

  // ---- Privé ------------------------------------------------------------------------------------------------------

  private brancher(id: string, duo: Duo): void {
    if (this.multiplexeur === null) return;
    const liaison = duo.brancherAiguilleur(this.multiplexeur.portPour(id));
    this.multiplexeur.ajouter({ id, liaison });
  }

  private debrancher(id: string, duo: Duo): void {
    this.multiplexeur?.retirer(id);
    duo.arreter();
  }

  // Ouvre l'emplacement d'un ami ajouté : son dossier, sa base propre (même schéma que celle du relais, tables duo
  // comprises), un Duo sans écoute directe. Les tables du relais restent vides : le Duo ne les lit pas.
  private ouvrirAmi(id: string): Duo | null {
    const dossier = this.index.creerDossier(id);
    if (dossier === null) return null;
    try {
      const base = ouvrirBase(join(dossier, 'duo.sqlite'));
      const duo = new Duo({ ...this.options, base, dossierSecrets: dossier, ecouteDirecte: false });
      this.bases.set(id, base);
      this.emplacements.set(id, duo);
      return duo;
    } catch (erreur) {
      this.options.journal.error({ err: erreur, ami: id }, 'emplacement d’ami non ouvert');
      return null;
    }
  }

  private creerAmi(): Resultat<string> {
    const id = this.nouvelIdentifiant();
    const duo = this.ouvrirAmi(id);
    if (duo === null) return echec(500, 'emplacement d’ami non créé');
    if (!this.changerEntree({ id, creeLe: this.maintenant(), suspendu: false })) {
      this.supprimerEmplacement(id);
      return echec(500, 'index des amis non écrit');
    }
    duo.demarrer();
    this.brancher(id, duo);
    duo.majDroits(DROITS_NOUVEL_AMI);
    return ok(id);
  }

  private emplacementLibre(): Emplacement | null {
    for (const [id, duo] of this.emplacements) {
      if (!this.suspendu(id) && duo.etat().pair === null) return { id, duo };
    }
    return null;
  }

  private supprimerEmplacement(id: string): void {
    this.emplacements.delete(id);
    this.bases.get(id)?.close();
    this.bases.delete(id);
    this.index.effacerDossier(id);
  }

  private changerEntree(entree: EntreeIndex): boolean {
    const avant = this.entrees.get(entree.id);
    this.entrees.set(entree.id, entree);
    if (this.persister()) return true;
    if (avant === undefined) this.entrees.delete(entree.id);
    else this.entrees.set(entree.id, avant);
    return false;
  }

  private persister(): boolean {
    return this.index.ecrire([...this.entrees.values()]);
  }

  private nouvelIdentifiant(): string {
    let id: string;
    do {
      id = randomBytes(6).toString('hex');
    } while (this.emplacements.has(id));
    return id;
  }

  private suspendu(id: string): boolean {
    return this.entrees.get(id)?.suspendu ?? false;
  }

  private fini(): Resultat<AmiDuo[]> {
    this.options.diffusion.diffuser({ type: 'duo_modifie' });
    return ok(this.lister());
  }

  private decrireDuo(id: string, duo: Duo): AmiDuo {
    const etat = duo.etat();
    return {
      id,
      nom: etat.pair?.nom ?? null,
      utilisateur: etat.pair?.utilisateur ?? null,
      etat: etat.etat,
      suspendu: this.suspendu(id),
      transport: etat.transport ?? null,
      appairage: Boolean(etat.appairage),
    };
  }

  private parSession(session: string): Resultat<Duo> {
    const pair = this.options.registre.session(session)?.duo?.pair;
    return pair === undefined ? echec(409, 'session sans pair') : this.parPair(pair);
  }

  private parPair(utilisateur: string): Resultat<Duo> {
    for (const [id, duo] of this.emplacements) {
      if (duo.etat().pair?.utilisateur !== utilisateur) continue;
      return this.suspendu(id) ? echec(409, 'ami suspendu') : ok(duo);
    }
    return echec(409, 'pair inconnu de ce nœud');
  }

  private maintenant(): string {
    return new Date((this.options.maintenant ?? Date.now)()).toISOString();
  }
}
