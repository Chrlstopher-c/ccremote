// Responsabilité : les routes des machines configurées (SSH) et de leurs dossiers, du test et de l'installation du poste.
// Un poste connecté sans configuration SSH (tour, portable) se parcourt par son propre accès (fichiers du poste).
import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { Logger } from 'pino';
import type { ListeDossier } from '../../commun/appareil.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from '../clients/http.ts';
import type { Postes } from '../parc/postes.ts';
import type { Acces } from '../acces/acces.ts';
import { listerDossiersSsh } from './dossiers.ts';
import { archiver, fichiersPoste, installerPoste, preparerDossier } from './installer.ts';
import { ConfigMachine, ID_MACHINE, ModifMachine, cheminValide } from './modele.ts';
import { type MachineConfiguree, type RegistreMachines } from './registre-machines.ts';
import { retirerSecretPoste, secretPoste } from './secrets.ts';
import { testerMachine } from './tester.ts';
import type { ConnexionSsh, Ssh } from './ssh.ts';

type Requete = Request & { params: Record<string, string> };

export interface DependancesMachines {
  readonly registre: RegistreMachines;
  readonly postes: Pick<Postes, 'commander' | 'enLigne'>;
  readonly ssh: Ssh;
  readonly secrets: Map<string, string>;
  readonly dossierSecrets: string;
  readonly relaisPostes: string | null; // URL WebSocket du relais vue depuis les machines (env, jamais dans le dépôt)
  readonly racineCode: string;
  readonly acces: Pick<Acces, 'emettre' | 'idsDeAppareil' | 'revoquer'>; // jeton claude-code du poste, pour les outils `machines` des sessions
  readonly urlApi: string | null; // URL de l'API du relais vue du poste distant (CCREMOTE_URL_API_POUR_POSTES)
  readonly journal: Logger;
  readonly maintenant?: () => string;
}

/** Un id réservé ne doit jamais devenir une machine (il déborde sur une route fixe). */
const IDS_RESERVES = new Set(['config']);

function connexion(c: MachineConfiguree): ConnexionSsh {
  return { hote: c.hote, port: c.port, utilisateur: c.utilisateur, cle: c.cle };
}

function cleLisible(cle: string): boolean {
  return existsSync(cle) && statSync(cle).isFile();
}

export class ApiMachines {
  constructor(private readonly d: DependancesMachines) {}

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

  liste(): Response {
    return json({ machines: this.d.registre.lister().map((c) => this.vue(c)) });
  }

  async ajouter(req: Request): Promise<Response> {
    const c = await lireCorps(req, ConfigMachine);
    if (c instanceof Response) return c;
    if (IDS_RESERVES.has(c.id)) return erreur(`identifiant réservé : ${c.id}`, 400);
    if (this.d.registre.lire(c.id)) return erreur(`machine déjà configurée : ${c.id}`, 409);
    if (!cleLisible(c.cle)) return erreur(`clé introuvable ou non fichier : ${c.cle}`, 400);
    this.d.registre.inserer(c, this.quand());
    this.d.journal.info({ machine: c.id }, 'machine SSH ajoutée');
    return json(this.vue(this.d.registre.lire(c.id) as MachineConfiguree), 201);
  }

  async modifier(req: Requete): Promise<Response> {
    const id = req.params['id'] ?? '';
    const actuelle = this.d.registre.lire(id);
    if (!actuelle) return erreur('machine inconnue', 404);
    const patch = await lireCorps(req, ModifMachine);
    if (patch instanceof Response) return patch;
    if (patch.cle !== undefined && !cleLisible(patch.cle)) return erreur(`clé introuvable : ${patch.cle}`, 400);
    this.d.registre.modifier(id, patch, this.quand());
    this.d.journal.info({ machine: id, champs: Object.keys(patch) }, 'machine SSH modifiée');
    return json(this.vue(this.d.registre.lire(id) as MachineConfiguree));
  }

  async supprimer(req: Requete): Promise<Response> {
    const id = req.params['id'] ?? '';
    if (!this.d.registre.supprimer(id)) return erreur('machine inconnue', 404);
    retirerSecretPoste(this.d.dossierSecrets, id, this.d.secrets);
    this.d.journal.info({ machine: id }, 'machine SSH supprimée (le poste distant, s’il existe, reste à arrêter)');
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
    if (!this.d.relaisPostes) return erreur('adresse du relais pour les postes non configurée (CCREMOTE_RELAIS_POSTES)', 409);
    // Un secret créé par cette tentative est retiré si elle échoue : « installé » ne vaut qu'après une installation réussie.
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

