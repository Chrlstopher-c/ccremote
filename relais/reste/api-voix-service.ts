// Responsabilité : le service de voix côté relais — l'état du service de chaque poste (postes locaux d'abord, puis
// ceux des pairs en ligne ; `local=1` pour un pair : les siens seuls), et son pilotage (démarrer, arrêter) sur la
// machine visée. Le relais ne parle jamais à systemd : il relaie l'action au poste qui la tient.
import type { Logger } from 'pino';
import {
  CorpsServiceVoix,
  DELAI_SERVICE_VOIX_MS,
  EtatServiceVoixPoste,
  ServiceVoixMachine,
} from '../../commun/voix-service.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from '../clients/http.ts';
import type { Postes } from '../parc/postes.ts';
import { avecDelai, DELAI } from './api-reste.ts';

export interface DependancesServiceVoix {
  readonly postes: Pick<Postes, 'vues' | 'commander'>;
  /** L'état du service de voix des postes des pairs en ligne (la liste `machines` de chacun, aplatie). */
  readonly pairs: { voixServiceDesPairs(): Promise<unknown[]> };
  readonly journal: Logger;
  /** Délai accordé à chaque poste pour son état (5 s par défaut) : réglable pour les tests. */
  readonly delaiEtatMs?: number;
}

type Requete = Request & { params: Record<string, string> };

const DELAI_ETAT_VOIX_MS = 5_000;

export class ApiServiceVoix {
  constructor(private readonly d: DependancesServiceVoix) {}

  /** Le service de voix de chaque machine : celles du parc (ordre du parc), puis celles des pairs en ligne. */
  async service(req: Request): Promise<Response> {
    const locales = await Promise.all(this.d.postes.vues().map((v) => this.serviceDe(v.id, v.enLigne)));
    if (new URL(req.url).searchParams.get('local') === '1') return json({ machines: locales });
    const distantes = await this.d.pairs.voixServiceDesPairs();
    return json({ machines: sansDoublonHorsLigne(locales, this.lireDistantes(distantes)) });
  }

  /** Démarrer ou arrêter le service d'une machine ; l'état rendu est celui relu après l'action. */
  async piloter(req: Requete): Promise<Response> {
    const id = req.params['id'] ?? '';
    if (!this.d.postes.vues().some((v) => v.id === id)) return erreur('machine inconnue', 404);
    const corps = await lireCorps(req, CorpsServiceVoix);
    if (corps instanceof Response) return corps;
    const r = await avecDelai(
      this.d.postes.commander(id, { kind: 'voix_service', action: corps.action }),
      DELAI_SERVICE_VOIX_MS,
    );
    if (r === DELAI) return erreur('pas de réponse du poste à temps', REFUS_POSTE);
    if (!r.ok) return erreur(r.erreur ?? 'action refusée', REFUS_POSTE);
    const lu = EtatServiceVoixPoste.safeParse(r.donnees);
    return lu.success ? json({ machine: id, ...lu.data }) : erreur('réponse du poste illisible', REFUS_POSTE);
  }

  private async serviceDe(id: string, enLigne: boolean): Promise<ServiceVoixMachine> {
    if (!enLigne) return absentDe(id, 'poste hors ligne');
    const attente = this.d.postes.commander(id, { kind: 'voix_service_etat' });
    const r = await avecDelai(attente, this.delaiEtat());
    if (r === DELAI || !r.ok) return absentDe(id, 'poste sans réponse');
    const lu = EtatServiceVoixPoste.safeParse(r.donnees);
    if (!lu.success) {
      this.d.journal.warn({ machine: id }, 'voix : service du poste illisible');
      return absentDe(id, 'poste sans réponse');
    }
    return { machine: id, ...lu.data };
  }

  // Une entrée d'un pair qui ne respecte pas la forme est ignorée, sans faire échouer la liste.
  private lireDistantes(entrees: readonly unknown[]): ServiceVoixMachine[] {
    const lues: ServiceVoixMachine[] = [];
    for (const entree of entrees) {
      const lu = ServiceVoixMachine.safeParse(entree);
      if (lu.success) lues.push(lu.data);
      else this.d.journal.warn('voix : entrée d’un pair illisible, ignorée');
    }
    return lues;
  }

  private delaiEtat(): number {
    return this.d.delaiEtatMs ?? DELAI_ETAT_VOIX_MS;
  }
}

// Un poste qu'on ne peut pas interroger est listé absent, la raison dans son message.
function absentDe(id: string, message: string): ServiceVoixMachine {
  return { machine: id, installe: false, etat: 'absent', depuis: null, message };
}

// Un ancien poste local hors ligne qui porte le nom d'une machine servie par un pair (la tour reliée en nœud) : seule
// l'entrée du pair compte, sinon le menu proposerait deux fois la même machine, dont une injoignable.
function sansDoublonHorsLigne<T extends { machine: string; message: string | null }>(
  locales: readonly T[],
  distantes: readonly T[],
): T[] {
  const servies = new Set(distantes.map((d) => d.machine));
  const gardees = locales.filter((l) => !(servies.has(l.machine) && l.message === 'poste hors ligne'));
  return [...gardees, ...distantes];
}
