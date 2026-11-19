// Responsabilité : les routes des machines configurées (SSH) et de leurs dossiers, du test et de l'installation du poste.
// Un poste connecté sans configuration SSH (tour, portable) se parcourt par son propre accès (fichiers du poste).
// En mode relais intégré (`integre`) : le poste Lanterne est installé, son accès passe par un tunnel SSH inverse
// (voir tunnels.ts), et un poste d'une autre version est mis à jour à sa connexion.
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { ListeDossier } from '../../commun/appareil.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from '../clients/http.ts';
import type { Postes } from '../parc/postes.ts';
import type { Acces } from '../acces/acces.ts';
import { listerDossiersSsh } from './dossiers.ts';
import { archiver, empreinteCode, extraireCodePoste, fichiersPoste, installerPoste, preparerDossier } from './installer.ts';
import { type Nommage, NOMMAGE_QUART } from './script-installation.ts';
import { ConfigMachine, ID_MACHINE, ModifMachine, cheminValide } from './modele.ts';
import { type MachineConfiguree, type RegistreMachines } from './registre-machines.ts';
import { retirerSecretPoste, secretPoste } from './secrets.ts';
import { testerMachine } from './tester.ts';
import type { ConnexionSsh, Ssh } from './ssh.ts';
import type { Tunnels } from './tunnels.ts';
import { assainirSortie, etapeDeLigne, Installations } from './installations.ts';

type Requete = Request & { params: Record<string, string> };

/** Réglages du relais intégré : nommage Lanterne, port distant par défaut, code du poste embarqué. */
export interface ModeIntegre {
  readonly nommage: Nommage;
  readonly portDistantDefaut: number;
  readonly codePoste: string | null; // archive LANTERNE_MOTEUR_CODE_POSTE ; absente : le code du dépôt
}

export interface DependancesMachines {
  readonly registre: RegistreMachines;
  readonly postes: Pick<Postes, 'commander' | 'enLigne' | 'rafraichirMachine'>;
  readonly ssh: Ssh;
  readonly secrets: Map<string, string>;
  readonly dossierSecrets: string;
  readonly relaisPostes: string | null; // URL WebSocket du relais vue depuis les machines (env, jamais dans le dépôt)
  readonly racineCode: string;
  readonly acces: Pick<Acces, 'emettre' | 'idsDeAppareil' | 'revoquer'>; // jeton claude-code du poste, pour les outils `machines` des sessions
  readonly urlApi: string | null; // URL de l'API du relais vue du poste distant (CCREMOTE_URL_API_POUR_POSTES)
  readonly journal: Logger;
  readonly maintenant?: () => string;
  readonly integre?: ModeIntegre;
  readonly tunnels?: Pick<Tunnels, 'synchroniser'>;
  readonly installations?: Installations;
}

/** Un id réservé ne doit jamais devenir une machine (il déborde sur une route fixe). */
const IDS_RESERVES = new Set(['config']);
const PORT_DISTANT_DEFAUT = 47321;
const DELAI_CONNEXION_MS = 90_000;

function connexion(c: MachineConfiguree): ConnexionSsh {
  return { hote: c.hote, port: c.port, utilisateur: c.utilisateur, cle: c.cle };
}

function cleLisible(cle: string): boolean {
  return existsSync(cle) && statSync(cle).isFile();
}

export class ApiMachines {
  private readonly installations: Installations;
  private readonly enInstallation = new Set<string>();

  constructor(private readonly d: DependancesMachines) {
    this.installations = d.installations ?? new Installations({ surChangement: () => undefined });
  }

  private quand(): string {
    return this.d.maintenant ? this.d.maintenant() : new Date().toISOString();
  }

  private vue(c: MachineConfiguree) {
    return {
      ...c,
      enLigne: this.d.postes.enLigne(c.id),
      posteInstalle: this.d.secrets.has(c.id),
    };
  }

  /** Tunnels alignés sur la base et les secrets (après chaque ajout, modification, suppression, installation). */
  private synchroniser(): void {
    this.d.tunnels?.synchroniser();
  }

  liste(): Response {
    return json({ machines: this.d.registre.lister().map((c) => this.vue(c)) });
  }

  async ajouter(req: Request): Promise<Response> {
    const c = await lireCorps(req, ConfigMachine);
    if (c instanceof Response) return c;
    if (IDS_RESERVES.has(c.id)) return erreur(`identifiant réservé : ${c.id}`, 400);
    if (this.d.registre.lire(c.id)) return erreur(`machine déjà configurée : ${c.id}`, 409);
    if (!cleLisible(c.cle)) return erreur(`clé introuvable ou non fichier : ${c.cle}`, 400);
    const portDistant = c.portDistant ?? this.d.integre?.portDistantDefaut ?? PORT_DISTANT_DEFAUT;
    if (this.d.registre.portPris(portDistant, c.id)) return erreur(`port distant déjà pris : ${portDistant}`, 409);
    this.d.registre.inserer(c, portDistant, this.quand());
    this.d.journal.info({ machine: c.id }, 'machine SSH ajoutée');
    this.synchroniser();
    return json(this.vue(this.d.registre.lire(c.id) as MachineConfiguree), 201);
  }

  async modifier(req: Requete): Promise<Response> {
    const id = req.params['id'] ?? '';
    const actuelle = this.d.registre.lire(id);
    if (!actuelle) return erreur('machine inconnue', 404);
    const patch = await lireCorps(req, ModifMachine);
    if (patch instanceof Response) return patch;
    if (patch.cle !== undefined && !cleLisible(patch.cle)) return erreur(`clé introuvable : ${patch.cle}`, 400);
    if (patch.portDistant !== undefined && this.d.registre.portPris(patch.portDistant, id)) {
      return erreur(`port distant déjà pris : ${patch.portDistant}`, 409);
    }
    this.d.registre.modifier(id, patch, this.quand());
    this.d.journal.info({ machine: id, champs: Object.keys(patch) }, 'machine SSH modifiée');
    this.synchroniser();
    this.d.postes.rafraichirMachine(id);
    return json(this.vue(this.d.registre.lire(id) as MachineConfiguree));
  }

  async supprimer(req: Requete): Promise<Response> {
    const id = req.params['id'] ?? '';
    if (!this.d.registre.supprimer(id)) return erreur('machine inconnue', 404);
    retirerSecretPoste(this.d.dossierSecrets, id, this.d.secrets);
    this.d.journal.info({ machine: id }, 'machine SSH supprimée (le poste distant, s’il existe, reste à arrêter)');
    this.synchroniser();
    this.d.postes.rafraichirMachine(id);
    return json({ ok: true, posteDistantArrete: false });
  }

  async tester(req: Requete): Promise<Response> {
    const c = this.d.registre.lire(req.params['id'] ?? '');
    if (!c) return erreur('machine inconnue', 404);
    const rapport = await testerMachine(
      this.d.ssh,
      connexion(c),
      this.d.postes.enLigne(c.id),
      this.d.secrets.has(c.id),
    );
    return json(rapport);
  }

  async dossiers(req: Requete): Promise<Response> {
    const id = req.params['id'] ?? '';
    const chemin = new URL(req.url).searchParams.get('chemin') ?? '';
    const c = this.d.registre.lire(id);
    if (!c) return this.dossiersDuPoste(id, chemin);
    const demande = chemin || c.dossier;
    if (!cheminValide(demande)) return erreur('chemin invalide', 400);
    const r = await listerDossiersSsh(this.d.ssh, connexion(c), demande);
    return r.ok ? json(r.liste) : erreur(r.erreur, REFUS_POSTE);
  }

  private async dossiersDuPoste(id: string, chemin: string): Promise<Response> {
    if (!ID_MACHINE.test(id)) return erreur('machine inconnue', 404);
    if (!this.d.postes.enLigne(id)) return erreur(`${id} est hors ligne`, REFUS_POSTE);
    const r = await this.d.postes.commander(id, { kind: 'fichiers_lister', chemin: chemin || undefined });
    if (!r.ok) return erreur(r.erreur ?? 'refusé', REFUS_POSTE);
    const liste = r.donnees as ListeDossier;
    return json({ ...liste, entrees: liste.entrees.filter((e) => e.type === 'dossier') });
  }

  async installer(req: Requete): Promise<Response> {
    const c = this.d.registre.lire(req.params['id'] ?? '');
    if (!c) return erreur('machine inconnue', 404);
    if (this.d.integre) return this.demarrerInstallation(c);
    return this.installerRelais(c);
  }

  /** Dernière installation d'une machine (étape, état, message) ; null si aucune n'a été lancée. */
  suivi(req: Requete): Response {
    const id = req.params['id'] ?? '';
    if (!this.d.registre.lire(id)) return erreur('machine inconnue', 404);
    return json(this.installations.de(id));
  }

  /** Le code du poste, lu dans l'archive embarquée (extraite le temps de l'action) ou dans le dépôt. */
  private async avecCode<T>(fonction: (racine: string) => Promise<T>): Promise<T> {
    const codePoste = this.d.integre?.codePoste ?? null;
    if (!codePoste) return fonction(this.d.racineCode);
    const dossier = await mkdtemp(join(tmpdir(), 'lanterne-code-'));
    try {
      return await fonction(await extraireCodePoste(codePoste, dossier));
    } finally {
      await rm(dossier, { recursive: true, force: true });
    }
  }

  /** Installation du poste Lanterne : répond tout de suite (202), l'installation tourne en fond, avancement suivi. */
  private demarrerInstallation(c: MachineConfiguree): Response {
    if (this.enInstallation.has(c.id)) return erreur(`installation déjà en cours : ${c.id}`, 409);
    this.enInstallation.add(c.id);
    this.installations.commencer(c.id);
    void this.executerInstallation(c, !this.d.secrets.has(c.id)).finally(() => this.enInstallation.delete(c.id));
    return json({ suivi: c.id }, 202);
  }

  /** Corps de l'installation : archive, envoi, étapes du script distant, puis attente de la connexion du poste. */
  private async executerInstallation(c: MachineConfiguree, nouveau: boolean): Promise<void> {
    const integre = this.d.integre;
    if (!integre) return;
    let dossier: string | null = null;
    try {
      const empreinte = await this.avecCode(empreinteCode);
      const secret = secretPoste(this.d.dossierSecrets, c.id, this.d.secrets);
      const relais = `ws://127.0.0.1:${c.portDistant}/poste`;
      const donnees = integre.nommage.dossierDonnees.replace('$HOME', '~');
      const fichiers = fichiersPoste(c.id, c.description, relais, secret, undefined, { donnees, empreinte });
      dossier = await preparerDossier(c.id, fichiers, integre.nommage);
      const dossierInstall = dossier;
      const archive = await this.avecCode((racine) => archiver(racine, dossierInstall));
      this.installations.etape(c.id, 'envoi');
      const r = await installerPoste(this.d.ssh, connexion(c), archive, (ligne) => this.surLigne(c.id, ligne));
      const resume = { machine: c.id, ok: r.ok, empreinte: empreinte.slice(0, 12) };
      this.d.journal.info(resume, 'installation du poste Lanterne');
      if (!r.ok) return this.echouer(c, nouveau, assainirSortie(r.sortie, c.hote));
      this.synchroniser();
      this.d.postes.rafraichirMachine(c.id);
      this.installations.etape(c.id, 'poste connecté');
      const connecte = await this.attendreConnexion(c.id, DELAI_CONNEXION_MS);
      this.installations.fin(c.id, connecte, connecte ? null : 'le poste ne s’est pas connecté dans le délai');
    } catch (e) {
      this.d.journal.warn({ machine: c.id, err: e }, 'installation du poste impossible');
      this.echouer(c, nouveau, 'installation impossible');
    } finally {
      if (dossier) await rm(dossier, { recursive: true, force: true });
    }
  }

  // Échec : le secret créé pour cette installation est retiré (« installé » ne vaut qu'après une réussite).
  private echouer(c: MachineConfiguree, nouveau: boolean, message: string): void {
    if (nouveau) retirerSecretPoste(this.d.dossierSecrets, c.id, this.d.secrets);
    this.installations.fin(c.id, false, message);
  }

  private surLigne(id: string, ligne: string): void {
    const etape = etapeDeLigne(ligne);
    if (etape) this.installations.etape(id, etape);
  }

  private async attendreConnexion(id: string, delaiMs: number): Promise<boolean> {
    const echeance = Date.now() + delaiMs;
    while (Date.now() < echeance) {
      if (this.d.postes.enLigne(id)) return true;
      await new Promise((resoudre) => setTimeout(resoudre, 1000));
    }
    return this.d.postes.enLigne(id);
  }

  /**
   * Un poste s'annonce avec l'empreinte de son code : si elle n'est pas celle du code embarqué, l'installation est
   * relancée (une fois par connexion, journalisée). Le secret et les bornes ne changent pas.
   */
  surConnexion(id: string, empreinte: string | undefined): void {
    if (!this.d.integre) return;
    const c = this.d.registre.lire(id);
    if (!c || !this.d.secrets.has(id)) return;
    if (!empreinte) {
      this.d.journal.info({ machine: id }, 'poste sans empreinte : pas de mise à jour automatique');
      return;
    }
    void this.mettreAJour(c, empreinte);
  }

  private async mettreAJour(c: MachineConfiguree, empreinte: string): Promise<void> {
    const attendue = await this.avecCode(empreinteCode).catch((e: unknown) => {
      this.d.journal.warn({ machine: c.id, err: e }, 'empreinte du code embarqué illisible');
      return null;
    });
    if (!attendue || attendue === empreinte) return;
    this.d.journal.info(
      { machine: c.id, de: empreinte.slice(0, 12), vers: attendue.slice(0, 12) },
      'poste d’une autre version : installation relancée',
    );
    this.demarrerInstallation(c);
  }

  /** Installation du poste par le relais de la tour (mode d'origine, inchangé). */
  private async installerRelais(c: MachineConfiguree): Promise<Response> {
    if (!this.d.relaisPostes) {
      return erreur('adresse du relais pour les postes non configurée (CCREMOTE_RELAIS_POSTES)', 409);
    }
    // Un secret créé par cette tentative est retiré si elle échoue : « installé » ne vaut qu'après une réussite.
    const nouveau = !this.d.secrets.has(c.id);
    const secret = secretPoste(this.d.dossierSecrets, c.id, this.d.secrets);
    // Un jeton par installation : les précédents sont révoqués si la nouvelle réussit, le sien si elle échoue.
    const nomPoste = `poste ${c.id}`;
    const anciens = this.d.acces.idsDeAppareil(nomPoste, 'claude-code');
    const jeton = this.d.urlApi ? this.d.acces.emettre({ nom: nomPoste, genre: 'claude-code', jours: 365 }) : null;
    const api = jeton && this.d.urlApi ? { url: this.d.urlApi, jeton: jeton.jeton } : undefined;
    const fichiers = fichiersPoste(c.id, c.description, this.d.relaisPostes, secret, api);
    const dossier = await preparerDossier(c.id, fichiers);
    try {
      const archive = await archiver(this.d.racineCode, dossier);
      const r = await installerPoste(this.d.ssh, connexion(c), archive);
      this.d.journal.info({ machine: c.id, ok: r.ok }, 'installation du poste distante');
      if (!r.ok) this.annulerJetons(c.id, nouveau, jeton?.id);
      else for (const id of anciens) this.d.acces.revoquer(id);
      return r.ok ? json({ ok: true, sortie: r.sortie }) : erreur(`installation échouée : ${r.sortie}`, REFUS_POSTE);
    } catch (e) {
      this.d.journal.warn({ machine: c.id, err: e }, 'installation du poste impossible');
      this.annulerJetons(c.id, nouveau, jeton?.id);
      return erreur(`installation impossible : ${String(e)}`, 500);
    } finally {
      await rm(dossier, { recursive: true, force: true });
    }
  }

  // Échec d'installation : le secret créé pour elle est retiré, et le jeton qu'elle a émis aussi.
  private annulerJetons(id: string, secretNouveau: boolean, jeton: string | undefined): void {
    if (secretNouveau) retirerSecretPoste(this.d.dossierSecrets, id, this.d.secrets);
    if (jeton) this.d.acces.revoquer(jeton);
  }
}
