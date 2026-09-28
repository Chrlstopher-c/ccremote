// Responsabilité : les comptes Claude Code du poste — relevé périodique (identité, usage), connexion d'un nouveau
// compte par OAuth, retrait. Chaque changement est publié au relais et, pour la liste, écrit dans la config du poste.
import { rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { type EtatCompte, NOM_COMPTE } from '../../commun/comptes.ts';
import { type ConfigPoste, enregistrerComptes } from '../config.ts';
import type { Reponse } from '../session/gestionnaire.ts';
import { abandonnerConnexion, demarrerConnexion, validerConnexion } from './connexion.ts';
import { binaireClaude } from '../session/lanceur.ts';
import { marquerAccueilFait } from '../session/confiance.ts';
import { environnementCompte, releverCompte } from './releve.ts';

const PERIODE_RELEVE_MS = 5 * 60_000;
const DOSSIER_COMPTES = join(homedir(), '.claude-comptes');

export interface DependancesComptes {
  readonly config: ConfigPoste;
  readonly journal: Logger;
  readonly publier: (comptes: EtatCompte[]) => void;
  /** Vrai si une session ouverte utilise ce compte : on ne le retire pas sous ses pieds. */
  readonly enUsage: (compte: string) => boolean;
}

export class Comptes {
  private readonly etats = new Map<string, EtatCompte>();
  private readonly connexions = new Map<string, { url: string; depuis: string }>();
  private releveEnCours: Promise<void> | null = null;

  constructor(private readonly d: DependancesComptes) {}

  demarrer(): void {
    void this.relever();
    setInterval(() => void this.relever(), PERIODE_RELEVE_MS);
  }

  lister(): EtatCompte[] {
    const connus = Object.keys(this.d.config.comptes).map((id) => this.etats.get(id) ?? this.provisoire(id));
    const enCours = [...this.connexions.keys()]
      .filter((id) => !(id in this.d.config.comptes))
      .map((id) => this.provisoire(id));
    return [...connus, ...enCours].map((e) => ({ ...e, connexion: this.connexions.get(e.id) ?? null }));
  }

  /** Relève tous les comptes (un seul relevé à la fois), puis publie. */
  relever(): Promise<void> {
    this.releveEnCours ??= this.releverTout().finally(() => {
      this.releveEnCours = null;
    });
    return this.releveEnCours;
  }

  async connecter(nom: string): Promise<Reponse> {
    if (!NOM_COMPTE.test(nom)) return { ok: false, erreur: 'nom de compte invalide (minuscules, chiffres, tirets)' };
    if (nom in this.d.config.comptes)
      return { ok: false, erreur: `le compte ${nom} existe déjà sur ${this.d.config.machine}` };
    const r = await demarrerConnexion(nom, join(DOSSIER_COMPTES, nom));
    if ('erreur' in r) return { ok: false, erreur: r.erreur };
    this.connexions.set(nom, { url: r.url, depuis: new Date().toISOString() });
    this.publier();
    return { ok: true, donnees: { url: r.url } };
  }

  async valider(nom: string, code: string): Promise<Reponse> {
    if (!this.connexions.has(nom)) return { ok: false, erreur: 'aucune connexion en cours pour ce compte' };
    const dossier = join(DOSSIER_COMPTES, nom);
    const erreur = await validerConnexion(nom, dossier, code);
    if (erreur) return { ok: false, erreur };
    this.connexions.delete(nom);
    marquerAccueilFait(dossier);
    this.d.config.comptes[nom] = dossier;
    enregistrerComptes(this.d.config.comptes);
    this.d.journal.info({ compte: nom }, 'compte connecté');
    await this.relever();
    return { ok: true, donnees: this.etats.get(nom) };
  }

  async retirer(nom: string): Promise<Reponse> {
    if (this.connexions.has(nom)) {
      await abandonnerConnexion(nom);
      this.connexions.delete(nom);
      rmSync(join(DOSSIER_COMPTES, nom), { recursive: true, force: true });
      this.publier();
      return { ok: true };
    }
    const dossier = this.d.config.comptes[nom];
    if (dossier === undefined) return { ok: false, erreur: `compte inconnu sur ${this.d.config.machine}` };
    if (dossier === null) return { ok: false, erreur: 'le compte par défaut de la machine ne se retire pas d’ici' };
    if (this.d.enUsage(nom)) return { ok: false, erreur: 'une session ouverte utilise ce compte : ferme-la d’abord' };
    await this.deconnecter(dossier);
    delete this.d.config.comptes[nom];
    this.etats.delete(nom);
    enregistrerComptes(this.d.config.comptes);
    // Seuls les dossiers créés par Quart sont effacés : un dossier configuré à la main reste en place.
    if (dossier.startsWith(`${DOSSIER_COMPTES}/`)) rmSync(dossier, { recursive: true, force: true });
    this.d.journal.info({ compte: nom }, 'compte retiré');
    this.publier();
    return { ok: true };
  }

  private async deconnecter(dossier: string): Promise<void> {
    const env = environnementCompte(dossier);
    const p = Bun.spawn([binaireClaude(), 'auth', 'logout'], { env, stdout: 'ignore', stderr: 'ignore' });
    await p.exited;
  }

  private async releverTout(): Promise<void> {
    const comptes = Object.entries(this.d.config.comptes);
    const etats = await Promise.all(comptes.map(([id, dir]) => releverCompte(id, dir, this.d.journal)));
    for (const e of etats) this.etats.set(e.id, e);
    this.publier();
  }

  private publier(): void {
    this.d.publier(this.lister());
  }

  private provisoire(id: string): EtatCompte {
    const vide = { session: null, semaine: null, autres: [], email: null, organisation: null, abonnement: null };
    const defaut = this.d.config.comptes[id] === null;
    return { id, defaut, connecte: false, ...vide, probleme: 'pas encore relevé', releveLe: '', connexion: null };
  }
}
