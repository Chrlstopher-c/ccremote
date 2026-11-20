// Responsabilité : lire la vue complète d'un compte Claude Code sur l'API OAuth d'Anthropic (profil, usage, offres
// de réinitialisation, crédits prépayés) et envoyer une réinitialisation de limite. Le jeton est lu à l'exécution,
// gardé le temps d'une requête, jamais journalisé ; l'uuid d'organisation ne sert qu'à construire les chemins.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { DetailCompte, ResultatReinitialisation, UsageSdk } from '../../commun/compte-detail.ts';
import { lireDetail } from './detail.ts';
import { echecReinitialisation, refusHttp, resultatReinitialisation } from './reinitialisation.ts';
import { objet, texte } from './valeurs.ts';

const API_PAR_DEFAUT = 'https://api.anthropic.com';
const CACHE_DETAIL_MS = 60_000;
const CACHE_PROFIL_MS = 10 * 60_000;
const DELAI_LECTURE_MS = 20_000;
const DELAI_REINITIALISATION_MS = 25_000;
const OFFRE_VALIDE = /^[a-z0-9_-]{1,40}$/;
const CHEMIN_CEDAR = '/api/oauth/usage?cedar_ember=1&skip_spend=1';
const SANS_JETON = 'jeton OAuth absent ou expiré : il se renouvelle à la prochaine session ouverte avec ce compte';

type Sdk = () => Promise<UsageSdk | null>;

export interface DependancesLecture {
  readonly api?: string;
  readonly journal: Logger;
  readonly maintenant?: () => number;
  readonly jeton?: (configDir: string | null) => string | null;
}

interface Profil {
  readonly brut: unknown;
  readonly orgUuid: string | null;
}

interface Memo<T> {
  readonly depuis: number;
  readonly valeur: T;
}

interface Lues {
  readonly profil: unknown | null;
  readonly usage: unknown | null;
  readonly cedar: unknown | null;
  readonly prepaye: unknown | null;
  readonly sdk: UsageSdk | null;
}

const AUCUNE: Lues = { profil: null, usage: null, cedar: null, prepaye: null, sdk: null };

const motif = (erreur: unknown): string => (erreur instanceof Error ? erreur.name : 'erreur');

// Le serveur déduit la surface de l'agent utilisateur : sans celui du CLI, le programme de réinitialisation répond
// « pas sur cette surface » (constaté le 20/11, lecture seule). Les sessions de Quart sont des Claude Code.
export const AGENT_CLI = 'claude-cli/2.1.323 (external, cli)';

function entetes(jeton: string): Record<string, string> {
  return {
    authorization: `Bearer ${jeton}`,
    'user-agent': AGENT_CLI,
    'anthropic-beta': 'oauth-2025-04-20',
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
}

/** Le jeton que Claude Code tient à jour dans `.credentials.json` ; absent, illisible ou expiré : null. */
function lireJetonFichier(configDir: string | null): string | null {
  const fichier = join(configDir ?? join(homedir(), '.claude'), '.credentials.json');
  if (!existsSync(fichier)) return null;
  const brut: unknown = JSON.parse(readFileSync(fichier, 'utf8'));
  const oauth = objet(objet(brut)['claudeAiOauth']);
  const valeur = texte(oauth['accessToken']);
  const expireLe = typeof oauth['expiresAt'] === 'number' ? oauth['expiresAt'] : 0;
  if (valeur === null || (expireLe > 0 && expireLe < Date.now())) return null;
  return valeur;
}

const uuidOrganisation = (profil: unknown): string | null => texte(objet(objet(profil)['organization'])['uuid']);

export class LecteurCompte {
  private readonly api: string;
  private readonly maintenant: () => number;
  private readonly details = new Map<string, Memo<Promise<DetailCompte>>>();
  private readonly profils = new Map<string, Memo<Profil>>();
  // Dernière réponse lue de chaque partie : l'endpoint d'usage limite son débit (429), on garde alors la précédente.
  private readonly derniers = new Map<string, unknown>();

  constructor(private readonly d: DependancesLecture) {
    this.api = d.api ?? API_PAR_DEFAUT;
    this.maintenant = d.maintenant ?? Date.now;
  }

  /** La vue complète d'un compte. Au plus un relevé réseau par minute ; les appels concurrents partagent le relevé. */
  detail(compte: string, configDir: string | null, machine: string, sdk: Sdk): Promise<DetailCompte> {
    const memo = this.details.get(compte);
    if (memo && this.maintenant() - memo.depuis < CACHE_DETAIL_MS) return memo.valeur;
    const valeur = this.relever(compte, configDir, machine, sdk);
    this.details.set(compte, { depuis: this.maintenant(), valeur });
    return valeur;
  }

  /** Utilise une offre de réinitialisation ; le relevé du compte est oublié dans tous les cas. */
  async reinitialiser(compte: string, configDir: string | null, offre: string): Promise<ResultatReinitialisation> {
    const resultat = await this.envoyerReinitialisation(compte, configDir, offre);
    this.details.delete(compte);
    return resultat;
  }

  private jetonDe(configDir: string | null): string | null {
    try {
      return (this.d.jeton ?? lireJetonFichier)(configDir);
    } catch (erreur) {
      this.d.journal.warn({ motif: motif(erreur) }, 'jeton du compte illisible');
      return null;
    }
  }

  private async relever(compte: string, configDir: string | null, machine: string, sdk: Sdk): Promise<DetailCompte> {
    const problemes: string[] = [];
    const jeton = this.jetonDe(configDir);
    if (jeton === null) {
      problemes.push(SANS_JETON);
      return this.assembler(compte, machine, { ...AUCUNE, sdk: await this.sdkDe(compte, sdk) }, problemes);
    }
    const [profil, usage, cedar, sdkLu] = await Promise.all([
      this.profilDe(compte, jeton, problemes),
      this.lire(compte, jeton, 'usage', '/api/oauth/usage', problemes),
      this.lire(compte, jeton, 'réinitialisations', CHEMIN_CEDAR, problemes),
      this.sdkDe(compte, sdk),
    ]);
    const prepaye = await this.prepayeDe(compte, jeton, profil, problemes);
    const lues = { profil: profil?.brut ?? null, usage, cedar, prepaye, sdk: sdkLu };
    return this.assembler(compte, machine, lues, problemes);
  }

  private assembler(compte: string, machine: string, l: Lues, problemes: string[]): DetailCompte {
    return lireDetail({
      compte,
      machine,
      releveLe: new Date(this.maintenant()).toISOString(),
      profil: l.profil,
      usage: l.usage,
      usageCedar: l.cedar,
      prepaye: l.prepaye,
      sdk: l.sdk,
      problemes,
    });
  }

  /** Une lecture GET ; en échec, la partie reste vide et une phrase part dans `problemes` (ni jeton, ni uuid). */
  private async lire(
    compte: string,
    jeton: string,
    quoi: string,
    chemin: string,
    problemes: string[],
  ): Promise<unknown> {
    try {
      const signal = AbortSignal.timeout(DELAI_LECTURE_MS);
      const r = await fetch(this.api + chemin, { headers: entetes(jeton), signal });
      if (!r.ok) {
        this.d.journal.warn({ compte, lecture: quoi, statut: r.status }, 'lecture du compte refusée');
        return this.precedent(compte, quoi, `HTTP ${r.status}`, problemes);
      }
      const corps: unknown = await r.json();
      this.derniers.set(`${compte}:${quoi}`, corps);
      return corps;
    } catch (erreur) {
      this.d.journal.warn({ compte, lecture: quoi, motif: motif(erreur) }, 'lecture du compte en échec');
      return this.precedent(compte, quoi, motif(erreur), problemes);
    }
  }

  /** Lecture en échec : la réponse précédente si on en a une (signalée comme ancienne), sinon rien. */
  private precedent(compte: string, quoi: string, cause: string, problemes: string[]): unknown {
    const ancien = this.derniers.get(`${compte}:${quoi}`);
    problemes.push(ancien === undefined ? `${quoi} illisible : ${cause}` : `${quoi} : relevé précédent (${cause})`);
    return ancien ?? null;
  }

  private async profilDe(compte: string, jeton: string, problemes: string[]): Promise<Profil | null> {
    const memo = this.profils.get(compte);
    if (memo && this.maintenant() - memo.depuis < CACHE_PROFIL_MS) return memo.valeur;
    const brut = await this.lire(compte, jeton, 'profil', '/api/oauth/profile', problemes);
    if (brut === null) return null;
    const valeur: Profil = { brut, orgUuid: uuidOrganisation(brut) };
    this.profils.set(compte, { depuis: this.maintenant(), valeur });
    return valeur;
  }

  private async prepayeDe(compte: string, jeton: string, profil: Profil | null, problemes: string[]): Promise<unknown> {
    if (profil === null) {
      problemes.push('crédits prépayés non lus : profil indisponible');
      return null;
    }
    if (profil.orgUuid === null) {
      problemes.push('crédits prépayés non lus : organisation inconnue');
      return null;
    }
    const chemin = `/api/oauth/organizations/${profil.orgUuid}/prepaid/credits`;
    return this.lire(compte, jeton, 'crédits prépayés', chemin, problemes);
  }

  private async sdkDe(compte: string, sdk: Sdk): Promise<UsageSdk | null> {
    try {
      return await sdk();
    } catch (erreur) {
      this.d.journal.warn({ compte, motif: motif(erreur) }, 'usage SDK non lu');
      return null;
    }
  }

  private async envoyerReinitialisation(
    compte: string,
    configDir: string | null,
    offre: string,
  ): Promise<ResultatReinitialisation> {
    if (!OFFRE_VALIDE.test(offre)) return echecReinitialisation('error', 'identifiant d’offre invalide');
    const jeton = this.jetonDe(configDir);
    if (jeton === null) return echecReinitialisation('auth_error', SANS_JETON);
    const problemes: string[] = [];
    const profil = await this.profilDe(compte, jeton, problemes);
    if (profil === null || profil.orgUuid === null)
      return echecReinitialisation('error', problemes[0] ?? 'organisation inconnue');
    return this.postReinitialisation(compte, jeton, profil.orgUuid, offre);
  }

  private async postReinitialisation(
    compte: string,
    jeton: string,
    org: string,
    offre: string,
  ): Promise<ResultatReinitialisation> {
    try {
      const r = await fetch(`${this.api}/api/organizations/${org}/reset_rate_limits`, {
        method: 'POST',
        headers: entetes(jeton),
        body: JSON.stringify({ program: 'cedar_ember', grant_id: offre, request_id: randomUUID() }),
        signal: AbortSignal.timeout(DELAI_REINITIALISATION_MS),
      });
      this.d.journal.info({ compte, offre, statut: r.status }, 'réinitialisation de limite envoyée');
      const refus = refusHttp(r.status);
      if (refus) return refus;
      const corps: unknown = await r.json();
      return resultatReinitialisation(corps);
    } catch (erreur) {
      this.d.journal.warn({ compte, offre, motif: motif(erreur) }, 'réinitialisation de limite en échec');
      return echecReinitialisation('error', `envoi impossible : ${motif(erreur)}`);
    }
  }
}
