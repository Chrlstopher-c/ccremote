// Responsabilité : le service de dictée du poste (P6, pilotage) — réglages persistés (arrêt après inactivité, pid du
// moteur lancé par ce poste), démarrer/arrêter/régler via le script moteur, latence et inactivité suivies, minuterie
// d'arrêt automatique. Un moteur lancé par quelqu'un d'autre (start.sh, pid différent) n'est jamais arrêté ici.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  ARRET_INACTIVITE_DEFAUT_MIN,
  type ActionServiceDictee,
  type EtatServiceDicteePoste,
} from '../../commun/dictee-service.ts';
import {
  type ActionMoteur,
  type EtatMoteur,
  derniereLigne,
  lancerMoteur,
  type LanceurMoteur,
  lireEtatMoteur,
} from './dictee-moteur.ts';

export const PERIODE_INACTIVITE_MS = 30_000;
const MS_PAR_MINUTE = 60_000;

const Reglages = z.object({
  arretInactiviteMin: z.number().int().min(0).max(1440),
  pidLance: z.number().int().nullable(),
});
type Reglages = z.infer<typeof Reglages>;
const REGLAGES_DEFAUT: Reglages = { arretInactiviteMin: ARRET_INACTIVITE_DEFAUT_MIN, pidLance: null };

export type ResultatPilotage =
  { readonly ok: true; readonly etat: EtatServiceDicteePoste } | { readonly ok: false; readonly erreur: string };

export interface DependancesServiceDictee {
  /** Chemin du script moteur, ou null s'il n'est pas installé sur ce poste. */
  readonly script: string | null;
  /** Dossier du socket et du PID : celui du socket de dictée, pour que script et socket concordent. */
  readonly dossierRun: string;
  readonly fichierReglages: string;
  readonly journal: Logger;
  readonly lancer?: LanceurMoteur;
  readonly horloge?: () => Date;
}

export class ServiceMoteurDictee {
  private reglages: Reglages;
  private latenceMs: number | null = null;
  private derniereActiviteMs: number | null = null;
  private minuterie: ReturnType<typeof setInterval> | null = null;
  private enVerification = false;
  private readonly lancer: LanceurMoteur;
  private readonly horloge: () => Date;

  constructor(private readonly d: DependancesServiceDictee) {
    this.reglages = lireReglages(d.fichierReglages, d.journal);
    this.lancer = d.lancer ?? lancerMoteur;
    this.horloge = d.horloge ?? (() => new Date());
  }

  /** L'état du service : le script (ou son absence), nos réglages et notre mémoire de ce poste. */
  async etat(): Promise<EtatServiceDicteePoste> {
    if (this.d.script === null) return this.vue(null);
    return this.vue(await this.lireMoteur(this.d.script));
  }

  /** Une action : démarrer, arrêter, ou régler la durée d'inactivité. L'état rendu est relu après l'action. */
  async piloter(action: ActionServiceDictee, minutes?: number): Promise<ResultatPilotage> {
    if (action === 'regler') return this.regler(minutes);
    if (this.d.script === null) return { ok: false, erreur: 'service de dictée non installé sur ce poste' };
    return action === 'demarrer' ? this.demarrer(this.d.script) : this.arreter(this.d.script);
  }

  /** Une transcription servie par ce poste : sa latence, et l'activité qui repousse l'arrêt automatique. */
  noterTranscription(ms: number): void {
    this.latenceMs = ms;
    this.derniereActiviteMs = this.horloge().getTime();
  }

  /** Un tour de la minuterie : le moteur lancé par ce poste s'arrête après `arretInactiviteMin` sans transcription. */
  async verifierInactivite(): Promise<void> {
    const { script } = this.d;
    const min = this.reglages.arretInactiviteMin;
    if (script === null || min === 0) return;
    const moteur = await this.lireMoteur(script);
    if (!this.estLanceParPoste(moteur)) return;
    const maintenant = this.horloge().getTime();
    this.derniereActiviteMs ??= maintenant;
    if (maintenant - this.derniereActiviteMs <= min * MS_PAR_MINUTE) return;
    const r = await this.piloter('arreter');
    if (r.ok) this.d.journal.info({ arretInactiviteMin: min }, 'dictée : moteur arrêté après inactivité');
    else this.d.journal.warn({ erreur: r.erreur }, 'dictée : arrêt après inactivité en échec');
  }

  demarrerSurveillance(): void {
    if (this.minuterie !== null) return;
    this.minuterie = setInterval(() => void this.tourSansEchec(), PERIODE_INACTIVITE_MS);
    this.minuterie.unref();
  }

  arreterSurveillance(): void {
    if (this.minuterie !== null) clearInterval(this.minuterie);
    this.minuterie = null;
  }

  private async tourSansEchec(): Promise<void> {
    if (this.enVerification) return;
    this.enVerification = true;
    try {
      await this.verifierInactivite();
    } catch (erreur) {
      this.d.journal.error({ err: erreur }, 'dictée : vérification d’inactivité en échec');
    } finally {
      this.enVerification = false;
    }
  }

  private async regler(minutes: number | undefined): Promise<ResultatPilotage> {
    if (minutes === undefined) return { ok: false, erreur: 'durée d’arrêt attendue' };
    this.reglages = { ...this.reglages, arretInactiviteMin: minutes };
    this.sauver();
    return { ok: true, etat: await this.etat() };
  }

  // Le pid n'est mémorisé que si le moteur vient d'être lancé ici : un moteur déjà en marche (start.sh) reste à Chris.
  private async demarrer(script: string): Promise<ResultatPilotage> {
    const avant = await this.lireMoteur(script);
    const erreur = await this.appeler(script, 'demarrer');
    if (erreur !== null) return { ok: false, erreur };
    const apres = await this.lireMoteur(script);
    if (avant.etat !== 'demarrage' && avant.etat !== 'pret' && apres.pid !== null) {
      this.reglages = { ...this.reglages, pidLance: apres.pid };
    }
    this.derniereActiviteMs = this.horloge().getTime();
    this.sauver();
    return { ok: true, etat: this.vue(apres) };
  }

  private async arreter(script: string): Promise<ResultatPilotage> {
    const erreur = await this.appeler(script, 'arreter');
    if (erreur !== null) return { ok: false, erreur };
    this.reglages = { ...this.reglages, pidLance: null };
    this.derniereActiviteMs = null;
    this.sauver();
    return { ok: true, etat: this.vue(await this.lireMoteur(script)) };
  }

  /** Lance une action du script ; rend null si elle a réussi, sinon la raison (dernière ligne utile). */
  private async appeler(script: string, action: ActionMoteur): Promise<string | null> {
    try {
      const s = await this.lancer(script, action, this.d.dossierRun);
      if (s.code === 0) return null;
      return derniereLigne(s.erreurs) ?? derniereLigne(s.sortie) ?? `code de sortie ${s.code}`;
    } catch (erreur) {
      this.d.journal.error({ err: erreur, action }, 'dictée : script moteur en échec');
      return erreur instanceof Error ? erreur.message : String(erreur);
    }
  }

  private async lireMoteur(script: string): Promise<EtatMoteur> {
    try {
      const s = await this.lancer(script, 'etat', this.d.dossierRun);
      const lu = s.code === 0 ? lireEtatMoteur(s.sortie) : null;
      if (lu !== null) return lu;
      this.d.journal.warn({ code: s.code }, 'dictée : état du moteur illisible');
    } catch (erreur) {
      this.d.journal.error({ err: erreur }, 'dictée : lecture de l’état du moteur en échec');
    }
    return {
      etat: 'erreur',
      pid: null,
      depuis: null,
      chargementMs: null,
      memoireGpuMo: null,
      message: 'état du moteur illisible',
    };
  }

  private estLanceParPoste(moteur: EtatMoteur): boolean {
    return moteur.pid !== null && moteur.pid === this.reglages.pidLance;
  }

  private vue(moteur: EtatMoteur | null): EtatServiceDicteePoste {
    const commun = {
      latenceMs: this.latenceMs,
      derniereActivite: this.derniereActiviteMs === null ? null : new Date(this.derniereActiviteMs).toISOString(),
      arretInactiviteMin: this.reglages.arretInactiviteMin,
    };
    if (moteur === null) {
      return {
        ...commun,
        installe: false,
        etat: 'absent',
        depuis: null,
        chargementMs: null,
        memoireGpuMo: null,
        lanceParPoste: false,
        message: 'service de dictée non installé sur ce poste',
      };
    }
    return {
      ...commun,
      installe: true,
      etat: moteur.etat,
      depuis: moteur.depuis,
      chargementMs: moteur.chargementMs,
      memoireGpuMo: moteur.memoireGpuMo,
      lanceParPoste: this.estLanceParPoste(moteur),
      message: moteur.message,
    };
  }

  private sauver(): void {
    const fichier = this.d.fichierReglages;
    try {
      mkdirSync(dirname(fichier), { recursive: true });
      writeFileSync(`${fichier}.tmp`, `${JSON.stringify(this.reglages, null, 2)}\n`);
      renameSync(`${fichier}.tmp`, fichier);
    } catch (erreur) {
      this.d.journal.error({ err: erreur }, 'dictée : réglages non enregistrés');
    }
  }
}

function lireReglages(fichier: string, journal: Logger): Reglages {
  try {
    return Reglages.parse(JSON.parse(readFileSync(fichier, 'utf8')));
  } catch (erreur) {
    const absent = erreur instanceof Error && 'code' in erreur && erreur.code === 'ENOENT';
    if (!absent) journal.warn({ err: erreur }, 'dictée : réglages illisibles, valeurs par défaut');
    return REGLAGES_DEFAUT;
  }
}
