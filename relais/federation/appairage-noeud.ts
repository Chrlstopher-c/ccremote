// Responsabilité : l'appairage d'un pair — premier contact (par l'aiguilleur ou en direct), demande tranchée par
// Chris, entrée dans la charte sous un chef, enregistrement du pair, et son retrait. Les demandes en attente sont
// ici.
import { empreinteIdentite, importerIdentitePublique } from '../../commun/chiffrement/identite.ts';
import { NOMBRE_MAX_DEMANDES } from '../../commun/federation.ts';
import type { CanalNoeud, PresentationDistante } from './canal.ts';
import type { DemandesAppairage } from './demandes.ts';
import { adresseDirecteValide } from './direct-noeud.ts';
import { echec, ok, type Resultat } from './resultat.ts';
import type { LiensNoeud } from './liens-noeud.ts';
import type { AdmissionsNoeud } from './admissions-noeud.ts';
import type { TerminalFedere } from './terminal-federe.ts';
import type { MachinesNoeud } from './machines-noeud.ts';
import type { Echanges } from './echanges.ts';
import type { PortNoeud } from './noeud-port.ts';
import type { PairFederee } from './secrets.ts';

/** Ce que l'appairage tient d'autres modules du nœud (liens, admissions, machines, demandes). */
export interface DepsAppairage {
  readonly liens: LiensNoeud;
  readonly admissions: AdmissionsNoeud;
  readonly demandes: DemandesAppairage;
  readonly terminaux: TerminalFedere;
  readonly machines: MachinesNoeud;
  readonly echanges: Echanges;
  readonly chefAppareilRelie: () => boolean;
}

export class AppairageNoeud {
  /** Adresses directes retenues pour un pair en attente d'accord (retenues seulement à l'accord). */
  private readonly adressesEnAttente = new Map<string, string>();

  constructor(
    private readonly port: PortNoeud,
    private readonly deps: DepsAppairage,
  ) {}

  /**
   * Un pair accepté est enregistré, sa révocation levée, et ses admissions diffusées si c'est un appareil. Seul le
   * nœud qui a demandé l'appairage peut fonder le réseau du parc (reprise) : le visé est la machine qu'on relie, et
   * c'est la charte du demandeur qu'il doit adopter, jamais un réseau concurrent.
   */
  private enregistrerPair(membre: string, presentation: PresentationDistante, demandeur: boolean): void {
    const config = this.port.config();
    const pair: PairFederee = {
      id: membre,
      nom: presentation.nom,
      identite: presentation.identite,
      creeLe: new Date().toISOString(),
      genre: presentation.genre ?? 'noeud',
      ...(presentation.genre === 'appareil' && config ? { admisPar: config.id } : {}),
    };
    this.port.definirPairs([...this.port.pairs().filter((p) => p.id !== membre), pair]);
    this.port.refus.delete(membre);
    if (demandeur) void this.port.charte.essayerReprise();
    this.deps.admissions.readmettre(membre);
    this.port.distant.connaitre(membre, pair.nom);
    this.port.sauverPairs();
    if (pair.genre === 'appareil') this.deps.admissions.diffuserAdmissions();
  }

  /** Premier contact avec un nœud en ligne : une demande part, Chris la tranche chez lui. */
  appairer(membre: string): Resultat<{ canal: string }> {
    if (!this.deps.liens.lien?.connecte() && !this.deps.liens.directs.joignable(membre)) {
      return echec(409, 'aiguilleur non relié');
    }
    if (this.port.pairs().some((p) => p.id === membre)) return echec(409, 'nœud déjà apparié');
    const refus = this.port.voisins.refusPour(membre, this.port.proprietaireLocal());
    if (refus) return echec(409, refus);
    if (!this.port.voisins.enLigne(membre)) return echec(409, 'nœud hors ligne');
    if (this.port.canaux.avec(membre)) return echec(409, 'un échange est déjà en cours avec ce nœud');
    const canal = this.port.canaux.ouvrir(membre, 'appairage');
    this.port.signaler();
    return canal ? ok({ canal: canal.id }) : echec(503, 'aucun chemin vers ce nœud');
  }

  /**
   * Premier contact sans aiguilleur : une liaison directe vers `adresse` (réseau local, VPN, tunnel), puis la demande
   * d'appairage, que Chris tranche chez le visé avec les deux empreintes. L'adresse n'est retenue qu'à l'accord.
   */
  async appairerDirect(adresse: string): Promise<Resultat<{ membre: string; canal: string }>> {
    if (!this.port.identifiantProtocole()) return echec(409, 'identité du nœud pas prête');
    if (!adresseDirecteValide(adresse)) return echec(400, 'adresse invalide');
    const lien = await this.deps.liens.directs.composerSortant(adresse, null);
    if (!lien?.pair) return echec(503, 'nœud injoignable à cette adresse');
    const membre = lien.pair.id;
    const refus = this.port.voisins.refusPour(membre, this.port.proprietaireLocal());
    if (refus) {
      lien.fermer('hors de nos machines');
      return echec(409, refus);
    }
    if (this.port.pairs().some((p) => p.id === membre)) return echec(409, 'nœud déjà apparié');
    if (this.port.canaux.avec(membre)) return echec(409, 'un échange est déjà en cours avec ce nœud');
    const canal = this.port.canaux.ouvrir(membre, 'appairage');
    if (!canal) return echec(503, 'aucun chemin vers ce nœud');
    this.adressesEnAttente.set(membre, adresse.trim());
    this.port.signaler();
    return ok({ membre, canal: canal.id });
  }

  // Côté visé : la demande part avec les deux empreintes ; Chris accepte ou refuse, l'expiration vaut refus.
  async presentationRecue(canal: CanalNoeud, presentation: PresentationDistante): Promise<void> {
    const refus =
      presentation.genre === 'appareil'
        ? this.port.voisins.refusAppareil(canal.membre, this.port.proprietaireLocal())
        : this.port.voisins.refusPour(canal.membre, this.port.proprietaireLocal());
    if (refus) {
      this.port.options.journal.warn(
        { membre: canal.membre, raison: refus },
        'présentation refusée : pas un de nos nœuds',
      );
      return canal.decider(false);
    }
    try {
      const empreinte = await empreinteIdentite(await importerIdentitePublique(presentation.identite));
      const locale = await empreinteIdentite((await this.port.identite()).publique);
      if (!canal.actif) return;
      const suite = this.port.charte.suiteAppairage(presentation, this.deps.chefAppareilRelie());
      if (suite === 'accord') return this.decisionAppairage(canal, presentation, true);
      if (suite === 'refus') {
        this.port.options.journal.warn(
          { membre: canal.membre },
          'présentation refusée : demande à un chef du réseau',
        );
        return canal.decider(false);
      }
      if (this.deps.demandes.lister().length >= NOMBRE_MAX_DEMANDES) return canal.decider(false);
      this.deps.demandes.ajouter(
        {
          membre: canal.membre,
          nom: presentation.nom,
          empreinte,
          empreinteLocale: locale,
          genre: presentation.genre ?? 'noeud',
          identite: presentation.identite,
        },
        (accord) => {
          void this.decisionAppairage(canal, presentation, accord);
          this.port.signaler();
        },
      );
      this.port.options.notifier?.(
        'Demande d’appairage',
        `${presentation.nom} demande à rejoindre tes machines : compare les empreintes dans Paramètres › Réseau.`,
      );
      this.port.signaler();
    } catch (erreur) {
      this.port.options.journal.error({ err: erreur, membre: canal.membre }, 'présentation d’un nœud illisible');
      canal.fermer();
    }
  }

  // Sous une charte, un accord fait d'abord entrer le membre dans la charte : sinon, le pair n'est pas admis.
  private async decisionAppairage(
    canal: CanalNoeud,
    presentation: PresentationDistante,
    accord: boolean,
  ): Promise<void> {
    if (accord && !(await this.port.charte.admettre(canal.membre, presentation))) return canal.decider(false);
    if (accord) this.enregistrerPair(canal.membre, presentation, false);
    canal.decider(accord);
  }

  // Appairage demandé d'ici (« Appairer » : une machine avec Lanterne) : sous une charte dont ce nœud est chef,
  // elle y entre comme pair. Un nœud ajouté par SSH demande lui-même, et entre comme serveur (decisionAppairage).
  appairageAccepte(membre: string, presentation: PresentationDistante): void {
    this.enregistrerPair(membre, presentation, true);
    const adresse = this.adressesEnAttente.get(membre);
    if (adresse !== undefined) {
      this.adressesEnAttente.delete(membre);
      this.deps.liens.directs.retenirAdresse(membre, adresse);
    }
    if (this.port.charte.estChef(this.port.identifiantProtocole() ?? '')) {
      void this.port.charte.admettre(membre, presentation, 'pair');
    }
  }

  oublierPair(membre: string): void {
    this.deps.terminaux.fermerPour(membre);
    this.port.definirPairs(this.port.pairs().filter((p) => p.id !== membre));
    this.port.sauverPairs();
    this.port.distant.retirer(membre);
    this.deps.machines.etats.oublier(membre);
    this.deps.demandes.retirerPour(membre);
    this.deps.echanges.oublier(membre);
    this.port.refus.delete(membre);
    this.deps.liens.directs.oublier(membre);
    this.deps.liens.directs.fermer(membre);
    this.port.voisins.retirerDirect(membre);
  }

  /**
   * Décision de Chris sur une demande. Locale : tranchée ici. Vue chez un autre nœud : relayée à ce nœud, qui la
   * tranche chez lui ; si ce nœud n'est pas relié, rien ne part (409). Jamais d'acceptation automatique.
   */
  decider(id: string, accord: boolean): Resultat<null> {
    return this.deps.demandes.decider(id, accord) ? ok(null) : echec(404, 'demande introuvable');
  }
}
