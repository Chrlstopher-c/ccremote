// Responsabilité : la dictée (P6) côté relais — le poste qui transcrit (celui que la requête nomme s'il a le service,
// sinon le premier en ligne qui l'a), l'état du service de chaque poste du parc, et son pilotage (démarrer, arrêter,
// régler). Le relais ne décode ni ne découpe l'audio : il le transmet tel quel au poste choisi.
import type { Logger } from 'pino';
import {
  CorpsDictee,
  DELAI_ETAT_DICTEE_MS,
  type EtatDictee,
  EtatDicteePoste,
  LANGUE_DICTEE_DEFAUT,
  ReponseDicteePoste,
} from '../../commun/reste-lot2.ts';
import {
  CorpsServiceDictee,
  DELAI_SERVICE_DICTEE_MS,
  EtatServiceDicteePoste,
  type ServiceDicteeMachine,
} from '../../commun/dictee-service.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from '../clients/http.ts';
import type { Postes } from '../parc/postes.ts';
import { avecDelai, DELAI } from './api-reste.ts';

export interface DependancesDictee {
  readonly postes: Pick<Postes, 'vues' | 'commander'>;
  readonly journal: Logger;
  /** Délai accordé à chaque poste pour son état (5 s par défaut) : réglable pour les tests. */
  readonly delaiEtatMs?: number;
}

type Requete = Request & { params: Record<string, string> };
type Choix = { readonly machine: string } | { readonly raison: string };

const RAISON_HORS_LIGNE = "Aucune machine du parc n'est en ligne.";
const RAISON_AUCUNE = "Aucune machine du parc n'a le service de dictée en marche.";

export class ApiDictee {
  constructor(private readonly d: DependancesDictee) {}

  /** L'état de la dictée du parc : le premier poste en ligne qui l'a, ou la raison. */
  async etat(): Promise<Response> {
    const choix = await this.choisir();
    const etat: EtatDictee =
      'machine' in choix
        ? { disponible: true, machine: choix.machine, raison: null }
        : { disponible: false, machine: null, raison: choix.raison };
    return json(etat);
  }

  /** Transcrit sur la machine nommée si elle a le service, sinon sur le premier qui l'a ; jamais d'erreur brute. */
  async transcrire(req: Request): Promise<Response> {
    const c = await lireCorps(req, CorpsDictee);
    if (c instanceof Response) return c;
    const choix = await this.choisir(c.machine);
    if (!('machine' in choix)) return json({ etat: 'absente', raison: choix.raison });
    const r = await this.d.postes.commander(choix.machine, {
      kind: 'dictee_transcrire',
      pcm16: c.pcm16,
      langue: c.langue ?? LANGUE_DICTEE_DEFAUT,
    });
    if (!r.ok) return json({ etat: 'erreur', raison: r.erreur ?? 'dictée injoignable' });
    const lu = ReponseDicteePoste.safeParse(r.donnees);
    if (!lu.success) return erreur('réponse du poste illisible', REFUS_POSTE);
    return json(lu.data.etat === 'ok' ? { ...lu.data, machine: choix.machine } : lu.data);
  }

  /** Le service de dictée de chaque machine, dans l'ordre du parc ; une machine muette ou hors ligne est listée. */
  async service(): Promise<Response> {
    const machines = await Promise.all(this.d.postes.vues().map((v) => this.serviceDe(v.id, v.enLigne)));
    return json({ machines });
  }

  /** Démarrer, arrêter ou régler le service d'une machine ; l'état rendu est celui relu après l'action. */
  async piloter(req: Requete): Promise<Response> {
    const id = req.params['id'] ?? '';
    if (!this.d.postes.vues().some((v) => v.id === id)) return erreur('machine inconnue', 404);
    const corps = await lireCorps(req, CorpsServiceDictee);
    if (corps instanceof Response) return corps;
    if (corps.action === 'regler' && corps.arretInactiviteMin === undefined) {
      return erreur('durée d’arrêt attendue', 400);
    }
    const r = await avecDelai(
      this.d.postes.commander(id, { kind: 'dictee_service', ...corps }),
      DELAI_SERVICE_DICTEE_MS,
    );
    if (r === DELAI) return erreur('pas de réponse du poste à temps', REFUS_POSTE);
    if (!r.ok) return erreur(r.erreur ?? 'action refusée', REFUS_POSTE);
    const lu = EtatServiceDicteePoste.safeParse(r.donnees);
    return lu.success ? json({ machine: id, ...lu.data }) : erreur('réponse du poste illisible', REFUS_POSTE);
  }

  // Postes en ligne interrogés en parallèle ; la machine nommée gagne si elle a le service, sinon le premier du parc.
  private async choisir(preferee?: string): Promise<Choix> {
    const enLigne = this.d.postes.vues().filter((v) => v.enLigne);
    if (enLigne.length === 0) return { raison: RAISON_HORS_LIGNE };
    const etats = await Promise.all(enLigne.map(async (v) => ({ id: v.id, etat: await this.etatDe(v.id) })));
    const disponible = (x: { readonly etat: EtatDicteePoste | null }): boolean => x.etat?.disponible === true;
    const trouve = etats.find((x) => x.id === preferee && disponible(x)) ?? etats.find(disponible);
    return trouve ? { machine: trouve.id } : { raison: RAISON_AUCUNE };
  }

  private async etatDe(id: string): Promise<EtatDicteePoste | null> {
    const attente = this.d.postes.commander(id, { kind: 'dictee_etat' });
    const r = await avecDelai(attente, this.delaiEtat());
    if (r === DELAI) return null;
    if (!r.ok) return null;
    const lu = EtatDicteePoste.safeParse(r.donnees);
    if (!lu.success) this.d.journal.warn({ machine: id }, 'dictée : état du poste illisible');
    return lu.success ? lu.data : null;
  }

  private async serviceDe(id: string, enLigne: boolean): Promise<ServiceDicteeMachine> {
    if (!enLigne) return absentDe(id, 'poste hors ligne');
    const attente = this.d.postes.commander(id, { kind: 'dictee_service_etat' });
    const r = await avecDelai(attente, this.delaiEtat());
    if (r === DELAI || !r.ok) return absentDe(id, 'poste sans réponse');
    const lu = EtatServiceDicteePoste.safeParse(r.donnees);
    if (!lu.success) {
      this.d.journal.warn({ machine: id }, 'dictée : service du poste illisible');
      return absentDe(id, 'poste sans réponse');
    }
    return { machine: id, ...lu.data };
  }

  private delaiEtat(): number {
    return this.d.delaiEtatMs ?? DELAI_ETAT_DICTEE_MS;
  }
}

// Un poste qu'on ne peut pas interroger est listé absent, la raison dans son message.
function absentDe(id: string, message: string): ServiceDicteeMachine {
  return {
    machine: id,
    installe: false,
    etat: 'absent',
    depuis: null,
    chargementMs: null,
    memoireGpuMo: null,
    latenceMs: null,
    derniereActivite: null,
    arretInactiviteMin: 0,
    lanceParPoste: false,
    message,
  };
}
