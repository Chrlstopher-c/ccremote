// Responsabilité : le service de voix du poste (unité systemd utilisateur lanterne-voix) — son état (unité installée,
// activité, sonde /sante du modèle prêt) et démarrer/arrêter sans attendre le chargement. Jamais de sudo : une unité
// absente = non installé. Systemctl et la sonde sont injectables (tests sans systemd).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { ActionServiceVoix, EtatServiceVoixPoste } from '../../commun/voix-service.ts';

export const UNITE_VOIX = 'lanterne-voix';
const DELAI_SONDE_MS = 1500;
const DELAI_SYSTEMCTL_MS = 10_000;
const MESSAGE_CHARGEMENT = 'modèle de voix en cours de chargement';
const PROPRIETES_UNITE = '--property=LoadState,ActiveState,ActiveEnterTimestamp';

export interface SortieSystemctl {
  readonly code: number;
  readonly sortie: string;
  readonly erreurs: string;
}
export type LanceurSystemctl = (args: string[]) => Promise<SortieSystemctl>;
export type SondeVoix = (url: string) => Promise<boolean>;
export type ResultatVoix =
  { readonly ok: true; readonly etat: EtatServiceVoixPoste } | { readonly ok: false; readonly erreur: string };

export interface DependancesServiceVoix {
  /** Adresse du service de voix sur ce poste, ou null : sans adresse, un service actif est tenu pour prêt. */
  readonly url: string | null;
  readonly journal: Logger;
  readonly lancer?: LanceurSystemctl;
  readonly sonder?: SondeVoix;
}

export class ServiceVoix {
  private readonly lancer: LanceurSystemctl;
  private readonly sonder: SondeVoix;

  constructor(private readonly d: DependancesServiceVoix) {
    this.lancer = d.lancer ?? lancerSystemctl;
    this.sonder = d.sonder ?? sonderVoix(d.journal);
  }

  /** L'état du service de voix de ce poste. Une lecture impossible donne « erreur », jamais une exception. */
  async etat(): Promise<EtatServiceVoixPoste> {
    const props = await this.lireUnite();
    if (props === null) {
      return { installe: false, etat: 'erreur', depuis: null, message: 'état du service de voix illisible' };
    }
    if (props['LoadState'] !== 'loaded') {
      return { installe: false, etat: 'absent', depuis: null, message: 'service de voix non installé sur ce poste' };
    }
    return this.vue(props);
  }

  /** Démarrer ou arrêter le service (sans attendre le chargement) ; l'état rendu est relu après l'action. */
  async piloter(action: ActionServiceVoix): Promise<ResultatVoix> {
    const avant = await this.etat();
    if (avant.etat === 'absent') return { ok: false, erreur: 'service de voix non installé sur ce poste' };
    const erreur = await this.agir(action === 'demarrer' ? 'start' : 'stop');
    if (erreur !== null) return { ok: false, erreur };
    return { ok: true, etat: await this.etat() };
  }

  private async vue(props: Record<string, string>): Promise<EtatServiceVoixPoste> {
    const actif = props['ActiveState'] ?? '';
    const depuis = actif === 'active' || actif === 'activating' ? isoDe(props['ActiveEnterTimestamp'] ?? '') : null;
    if (actif === 'active') {
      const pret = this.d.url === null || (await this.sonder(this.d.url));
      return pret
        ? { installe: true, etat: 'pret', depuis, message: null }
        : { installe: true, etat: 'demarrage', depuis, message: MESSAGE_CHARGEMENT };
    }
    if (actif === 'activating' || actif === 'reloading') {
      return { installe: true, etat: 'demarrage', depuis, message: MESSAGE_CHARGEMENT };
    }
    if (actif === 'failed') {
      return {
        installe: true,
        etat: 'erreur',
        depuis: null,
        message: 'le service de voix s’est arrêté sur une erreur',
      };
    }
    return { installe: true, etat: 'arrete', depuis: null, message: null };
  }

  private async lireUnite(): Promise<Record<string, string> | null> {
    const s = await this.appel(['--user', 'show', UNITE_VOIX, PROPRIETES_UNITE, '--timestamp=unix']);
    if (s === null) return null;
    if (s.code !== 0) {
      this.d.journal.warn({ code: s.code }, 'voix : état du service illisible');
      return null;
    }
    return lireProprietes(s.sortie);
  }

  /** Lance start ou stop ; rend null si elle a réussi, sinon la raison (dernière ligne utile). */
  private async agir(verbe: 'start' | 'stop'): Promise<string | null> {
    const s = await this.appel(['--user', verbe, '--no-block', UNITE_VOIX]);
    if (s === null) return 'systemctl injoignable';
    if (s.code === 0) return null;
    return derniereLigne(s.erreurs) ?? derniereLigne(s.sortie) ?? `code de sortie ${s.code}`;
  }

  private async appel(args: string[]): Promise<SortieSystemctl | null> {
    try {
      return await this.lancer(args);
    } catch (erreur) {
      this.d.journal.error({ err: erreur, args }, 'voix : systemctl en échec');
      return null;
    }
  }
}

/** Lance `systemctl` avec ces arguments ; au-delà de `DELAI_SYSTEMCTL_MS`, le processus est arrêté. */
export async function lancerSystemctl(args: string[]): Promise<SortieSystemctl> {
  const proc = Bun.spawn(['systemctl', ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const minuterie = setTimeout(() => proc.kill(), DELAI_SYSTEMCTL_MS);
  try {
    const [sortie, erreurs, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, sortie, erreurs };
  } finally {
    clearTimeout(minuterie);
  }
}

/** La sonde du modèle : `GET <url>/sante` répond 200 quand il est prêt. Injoignable = pas encore prêt. */
export function sonderVoix(journal: Logger): SondeVoix {
  return async (url) => {
    try {
      const reponse = await fetch(`${url}/sante`, { signal: AbortSignal.timeout(DELAI_SONDE_MS) });
      return reponse.ok;
    } catch (erreur) {
      journal.debug({ err: erreur }, 'voix : service pas encore prêt');
      return false;
    }
  };
}

/** Adresse du service de voix de ce poste : LANTERNE_VOIX_URL, sinon `~/.config/ccremote/voix.url`. */
export function urlVoixPoste(
  env: Readonly<Record<string, string | undefined>>,
  journal: Logger,
  dossier = join(homedir(), '.config/ccremote'),
): string | null {
  const brute = env['LANTERNE_VOIX_URL'] ?? lireFichier(join(dossier, 'voix.url'), journal);
  const url = brute?.trim().replace(/\/+$/, '');
  return url && /^https?:\/\//.test(url) ? url : null;
}

function lireFichier(chemin: string, journal: Logger): string | undefined {
  try {
    return readFileSync(chemin, 'utf8');
  } catch (erreur) {
    journal.debug({ err: erreur, chemin }, 'voix : pas d’adresse de service de voix sur ce poste');
    return undefined;
  }
}

// Les propriétés `clé=valeur` de systemctl show.
function lireProprietes(sortie: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const ligne of sortie.split('\n')) {
    const i = ligne.indexOf('=');
    if (i > 0) props[ligne.slice(0, i)] = ligne.slice(i + 1).trim();
  }
  return props;
}

// systemctl --timestamp=unix rend `@<secondes>` ; une date absente (jamais démarrée) rend une chaîne vide.
function isoDe(brut: string): string | null {
  const secondes = /^@(\d+)$/.exec(brut.trim())?.[1];
  return secondes === undefined ? null : new Date(Number(secondes) * 1000).toISOString();
}

function derniereLigne(sortie: string): string | null {
  const lignes = sortie
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return lignes.at(-1) ?? null;
}
