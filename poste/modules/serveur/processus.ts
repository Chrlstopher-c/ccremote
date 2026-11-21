// Responsabilité : le cycle de vie du serveur d'UN module sur ce poste — installation des dépendances, port libre,
// attente qu'il écoute, relance avec recul après plantage, panne définitive, arrêt par le handle que nous avons lancé.
// Les opérations passent une à une par une file : un redémarrage ne croise jamais un lancement en cours.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Logger } from 'pino';
import { DOSSIER_SERVEUR, type EtatServeur } from '../../../commun/modules.ts';
import { attendrePort, environnementServeur, portLibre, tuer } from './lancement.ts';

export interface ReglagesProcessus {
  readonly commande: (point: string) => string[];
  readonly delais: readonly number[]; // recul des relances après plantage, en ms ; épuisé → panne
  readonly delaiPretMs: number;
  readonly delaiStableMs: number; // prêt depuis au moins cette durée : un plantage repart de la première relance
  readonly delaiArretMs: number; // SIGTERM puis SIGKILL après ce délai
}

export interface ParamsProcessus {
  readonly id: string;
  readonly dossier: string; // racine du module : cwd du serveur
  readonly point: string; // serveur/index.ts
  readonly donnees: string; // MODULE_DONNEES
  readonly fichierJournal: string; // remis à zéro à chaque lancement
  readonly reglages: ReglagesProcessus;
  readonly surEtat: (etat: EtatServeur, erreur?: string) => void;
  readonly journal: Logger;
}

export class ProcessusServeur {
  /** Empreinte des fichiers serveur/ au dernier démarrage voulu : un changement redémarre le serveur. */
  empreinte = '';
  private proc: Bun.Subprocess | null = null;
  private port = 0;
  private etatCourant: EtatServeur = 'arrete';
  private erreurCourante: string | undefined;
  private plantages = 0;
  private pretDepuis = 0;
  private arretDemande = false;
  private minuterie: ReturnType<typeof setTimeout> | null = null;
  private file: Promise<void> = Promise.resolve();
  private paquetInstalle: string | null = null;

  constructor(private readonly p: ParamsProcessus) {}

  etat(): { readonly etat: EtatServeur; readonly erreur: string | undefined } {
    return { etat: this.etatCourant, erreur: this.erreurCourante };
  }

  portEcoute(): number {
    return this.port;
  }

  demarrer(empreinte: string): Promise<void> {
    this.empreinte = empreinte;
    return this.enFile(() => this.lancer());
  }

  redemarrer(empreinte: string): Promise<void> {
    this.empreinte = empreinte;
    return this.enFile(async () => {
      await this.arretProc();
      this.plantages = 0;
      await this.lancer();
    });
  }

  arreter(): Promise<void> {
    this.arretDemande = true;
    this.annulerRelance();
    return this.enFile(async () => {
      await this.arretProc();
      this.fixer('arrete');
    });
  }

  /** Renvoie l'état courant au relais (après sa reconnexion). */
  republier(): void {
    this.p.surEtat(this.etatCourant, this.erreurCourante);
  }

  private enFile(tache: () => Promise<void>): Promise<void> {
    this.file = this.file.then(tache).catch((erreur: unknown) => {
      this.p.journal.error({ err: erreur, module: this.p.id }, 'opération du serveur échouée');
    });
    return this.file;
  }

  private async lancer(): Promise<void> {
    this.arretDemande = false;
    this.pretDepuis = 0;
    this.fixer('demarrage');
    let sortie: number | null = null;
    try {
      mkdirSync(this.p.donnees, { recursive: true });
      mkdirSync(dirname(this.p.fichierJournal), { recursive: true });
      sortie = openSync(this.p.fichierJournal, 'w'); // remis à zéro à chaque lancement
      await this.installerSiBesoin(sortie);
      this.port = await portLibre();
      await this.lancerProc(sortie);
    } catch (erreur) {
      this.onPlantage(erreur instanceof Error ? erreur.message : String(erreur));
    } finally {
      if (sortie !== null) closeSync(sortie);
    }
  }

  private async installerSiBesoin(sortie: number): Promise<void> {
    const dossier = join(this.p.dossier, DOSSIER_SERVEUR);
    const paquet = join(dossier, 'package.json');
    if (!existsSync(paquet)) return;
    const empreinte = createHash('sha256').update(readFileSync(paquet)).digest('hex');
    if (empreinte === this.paquetInstalle) return;
    const installation = Bun.spawn(['bun', 'install', '--production'], {
      cwd: dossier,
      stdout: sortie,
      stderr: sortie,
    });
    const code = await installation.exited;
    if (code !== 0) throw new Error(`bun install a échoué (code ${code})`);
    this.paquetInstalle = empreinte;
  }

  private async lancerProc(sortie: number): Promise<void> {
    const proc = this.creerProc(sortie);
    const pret = await attendrePort(this.port, this.p.reglages.delaiPretMs, () => {
      return this.proc === proc && !this.arretDemande;
    });
    if (this.proc !== proc || this.arretDemande) return;
    if (!pret) {
      this.proc = null;
      await tuer(proc, this.p.reglages.delaiArretMs);
      this.onPlantage('pas prêt à temps');
      return;
    }
    this.pretDepuis = Date.now();
    this.fixer('pret');
  }

  private creerProc(sortie: number): Bun.Subprocess {
    const env = environnementServeur({ id: this.p.id, port: this.port, donnees: this.p.donnees });
    const proc = Bun.spawn(this.p.reglages.commande(this.p.point), {
      cwd: this.p.dossier,
      env,
      stdout: sortie,
      stderr: sortie,
    });
    this.proc = proc;
    void proc.exited.then((code) => this.surSortie(proc, code));
    return proc;
  }

  // Une sortie qui n'est pas la nôtre (arrêt ou redémarrage voulu) ne compte pas comme plantage.
  private surSortie(proc: Bun.Subprocess, code: number | null): void {
    if (this.proc !== proc) return;
    this.proc = null;
    if (this.arretDemande) return;
    this.onPlantage(`le serveur s’est arrêté (code ${String(code)})`);
  }

  private onPlantage(raison: string): void {
    if (this.arretDemande) return;
    const { delaiStableMs, delais } = this.p.reglages;
    if (this.pretDepuis !== 0 && Date.now() - this.pretDepuis >= delaiStableMs) this.plantages = 0;
    this.plantages += 1;
    const delai = delais[this.plantages - 1];
    if (delai === undefined) {
      this.fixer('panne', `${raison} ; relances épuisées`);
      return;
    }
    this.fixer('demarrage', `${raison} ; relance dans ${delai} ms`);
    this.minuterie = setTimeout(() => {
      this.minuterie = null;
      void this.enFile(() => this.lancer());
    }, delai);
  }

  private annulerRelance(): void {
    if (this.minuterie !== null) clearTimeout(this.minuterie);
    this.minuterie = null;
  }

  private async arretProc(): Promise<void> {
    this.annulerRelance();
    const proc = this.proc;
    this.proc = null;
    if (proc !== null) await tuer(proc, this.p.reglages.delaiArretMs);
  }

  private fixer(etat: EtatServeur, erreur?: string): void {
    if (etat === this.etatCourant && erreur === this.erreurCourante) return;
    this.etatCourant = etat;
    this.erreurCourante = erreur;
    this.p.surEtat(etat, erreur);
  }
}
