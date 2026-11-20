// Responsabilité : la dictée (P6) côté relais — le premier poste en ligne qui a le service transcrit. Le relais ne
// décode ni ne découpe l'audio : il le transmet tel quel au poste choisi.
import type { Logger } from 'pino';
import {
  CorpsDictee,
  DELAI_ETAT_DICTEE_MS,
  type EtatDictee,
  EtatDicteePoste,
  LANGUE_DICTEE_DEFAUT,
  ReponseDicteePoste,
} from '../../commun/reste-lot2.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from '../clients/http.ts';
import type { Postes } from '../parc/postes.ts';
import { avecDelai, DELAI } from './api-reste.ts';

export interface DependancesDictee {
  readonly postes: Pick<Postes, 'vues' | 'commander'>;
  readonly journal: Logger;
}

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

  /** Transcrit l'audio sur le premier poste qui a le service ; sans service, un avis clair, jamais une erreur brute. */
  async transcrire(req: Request): Promise<Response> {
    const c = await lireCorps(req, CorpsDictee);
    if (c instanceof Response) return c;
    const choix = await this.choisir();
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

  // Les postes en ligne interrogés en parallèle ; le premier dans l'ordre du parc qui répond « disponible » gagne.
  private async choisir(): Promise<Choix> {
    const enLigne = this.d.postes.vues().filter((v) => v.enLigne);
    if (enLigne.length === 0) return { raison: RAISON_HORS_LIGNE };
    const etats = await Promise.all(enLigne.map(async (v) => ({ id: v.id, etat: await this.etatDe(v.id) })));
    const trouve = etats.find((x) => x.etat?.disponible === true);
    return trouve ? { machine: trouve.id } : { raison: RAISON_AUCUNE };
  }

  private async etatDe(id: string): Promise<EtatDicteePoste | null> {
    const attente = this.d.postes.commander(id, { kind: 'dictee_etat' });
    const r = await avecDelai(attente, DELAI_ETAT_DICTEE_MS);
    if (r === DELAI) return null;
    if (!r.ok) return null;
    const lu = EtatDicteePoste.safeParse(r.donnees);
    if (!lu.success) this.d.journal.warn({ machine: id }, 'dictée : état du poste illisible');
    return lu.success ? lu.data : null;
  }
}
