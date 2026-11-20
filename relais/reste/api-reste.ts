// Responsabilité : les lectures et gestes de la vague « reste » du relais — recherche globale (registre et transcripts
// des postes en ligne, fusionnés), mémoire Hippocampe lue sur un poste, jetons d'une session, commandes Claude d'une
// machine. Chaque lecture de poste est relayée ; le relais ne lit aucun fichier lui-même.
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  ERREUR_COMMANDE_EXISTANTE,
  LIMITE_RECHERCHE_MAX,
  LONGUEUR_MAX_REQUETE,
  ListeCommandes,
  MAX_CONTENU_COMMANDE,
  MAX_DESCRIPTION_COMMANDE,
  NOM_COMMANDE,
  OUTILS_MEMOIRE,
  type OutilMemoire,
  ReponseMemoire,
  type ResultatRecherche,
  ResultatsTranscripts,
} from '../../commun/reste.ts';
import { entier, erreur, json, lireCorps, REFUS_POSTE } from '../clients/http.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';

export const DELAI_RECHERCHE_POSTE_MS = 15_000;
const LIMITE_DEFAUT = 30;
const PAR_SESSION = 3;
const JOURS_DEFAUT = 7;
const JOURS_MAX = 365;
const LONGUEUR_MAX_PROJET = 200;
export const DELAI = Symbol('delai');

type Requete = Request & { params: Record<string, string> };

export interface MachineRecherche {
  readonly machine: string;
  readonly joignable: boolean;
  readonly erreur: string | null;
}

export interface DependancesReste {
  readonly registre: Pick<Registre, 'rechercherMessages' | 'jetonsSession' | 'sessions'>;
  readonly postes: Pick<Postes, 'vues' | 'enLigne' | 'commander'>;
  readonly journal: Logger;
  /** Délai accordé à chaque poste pour la recherche (15 s par défaut). */
  readonly delaiRechercheMs?: number;
}

const CorpsCommande = z.object({
  nom: z.string().regex(NOM_COMMANDE),
  description: z.string().max(MAX_DESCRIPTION_COMMANDE),
  contenu: z.string().min(1).max(MAX_CONTENU_COMMANDE),
});

interface Interrogation {
  readonly machine: MachineRecherche;
  readonly resultats: ResultatRecherche[];
}

export class ApiReste {
  constructor(private readonly d: DependancesReste) {}

  /** Recherche globale : messages du registre et transcripts des postes en ligne, les plus récents d'abord. */
  async recherche(req: Request): Promise<Response> {
    const p = new URL(req.url).searchParams;
    const q = (p.get('q') ?? '').trim();
    if (q.length > LONGUEUR_MAX_REQUETE) return erreur('recherche trop longue', 400);
    const limite = Math.min(LIMITE_RECHERCHE_MAX, Math.max(1, entier(p.get('limite'), LIMITE_DEFAUT)));
    if (q.length < 2) return json({ resultats: [], machines: [], tronque: false });
    const relais: ResultatRecherche[] = this.d.registre
      .rechercherMessages(q, limite + 1, PAR_SESSION)
      .map((r): ResultatRecherche => ({ ...r, source: 'relais' }));
    const { machines, transcripts } = await this.interrogerPostes(q, limite + 1);
    const fusion = [...relais, ...this.transcriptsRetenus(transcripts)].sort((a, b) => b.ts.localeCompare(a.ts));
    return json({ resultats: fusion.slice(0, limite), machines, tronque: fusion.length > limite });
  }

  /** La mémoire Hippocampe d'une machine : le poste lit son serveur MCP et n'appelle que trois outils. */
  async memoire(req: Requete): Promise<Response> {
    const id = req.params['id'] ?? '';
    if (!this.connue(id)) return erreur('machine inconnue', 404);
    const demande = demandeMemoire(new URL(req.url).searchParams);
    if (typeof demande === 'string') return erreur(demande, 400);
    const r = await this.d.postes.commander(id, { kind: 'memoire_lire', ...demande });
    if (!r.ok) return json({ etat: 'erreur', raison: r.erreur ?? 'mémoire injoignable' });
    const lue = ReponseMemoire.safeParse(r.donnees);
    return lue.success ? json(lue.data) : json({ etat: 'erreur', raison: 'réponse du poste illisible' });
  }

  /** Jetons d'une session : somme des tours terminés du registre (zéros si la session est inconnue). */
  jetons(req: Requete): Response {
    return json(this.d.registre.jetonsSession(req.params['id'] ?? ''));
  }

  async commandes(req: Requete): Promise<Response> {
    const id = req.params['id'] ?? '';
    if (!this.connue(id)) return erreur('machine inconnue', 404);
    const r = await this.d.postes.commander(id, { kind: 'commandes_lister' });
    if (!r.ok) return erreur(r.erreur ?? 'commandes illisibles', REFUS_POSTE);
    const lues = ListeCommandes.safeParse(r.donnees);
    return lues.success ? json(lues.data) : erreur('réponse du poste illisible', REFUS_POSTE);
  }

  async creerCommande(req: Requete): Promise<Response> {
    const id = req.params['id'] ?? '';
    if (!this.connue(id)) return erreur('machine inconnue', 404);
    const c = await lireCorps(req, CorpsCommande);
    if (c instanceof Response) return c;
    const r = await this.d.postes.commander(id, { kind: 'commande_creer', ...c });
    if (r.ok) return json({ nom: c.nom }, 201);
    if (r.erreur === ERREUR_COMMANDE_EXISTANTE) return erreur('Une commande de ce nom existe déjà', 409);
    return erreur(r.erreur ?? 'création refusée', REFUS_POSTE);
  }

  private connue(id: string): boolean {
    return this.d.postes.vues().some((v) => v.id === id);
  }

  private async interrogerPostes(
    q: string,
    limite: number,
  ): Promise<{ machines: MachineRecherche[]; transcripts: ResultatRecherche[] }> {
    const parPoste = await Promise.all(this.d.postes.vues().map((v) => this.chercherSur(v.id, v.enLigne, q, limite)));
    return {
      machines: parPoste.map((x) => x.machine),
      transcripts: parPoste.flatMap((x) => x.resultats),
    };
  }

  private async chercherSur(id: string, enLigne: boolean, texte: string, limite: number): Promise<Interrogation> {
    if (!enLigne) return echec(id, 'hors ligne');
    const attente = this.d.postes.commander(id, { kind: 'rechercher_transcripts', texte, limite });
    const r = await avecDelai(attente, this.d.delaiRechercheMs ?? DELAI_RECHERCHE_POSTE_MS);
    if (r === DELAI) return echec(id, 'pas de réponse à temps');
    return this.lireReponseRecherche(id, r);
  }

  private lireReponseRecherche(id: string, r: ReponsePoste): Interrogation {
    if (!r.ok) return echec(id, r.erreur ?? 'recherche refusée');
    const lus = ResultatsTranscripts.safeParse(r.donnees);
    if (!lus.success) {
      this.d.journal.warn({ machine: id }, 'recherche : réponse du poste illisible');
      return echec(id, 'réponse illisible');
    }
    const resultats = lus.data.resultats.map((t): ResultatRecherche => ({
      ...t,
      machine: id,
      seq: null,
      source: 'transcript',
    }));
    return { machine: { machine: id, joignable: true, erreur: null }, resultats };
  }

  // Une session déjà dans le registre écarte ses transcripts (son fil y est) ; au plus PAR_SESSION par session.
  private transcriptsRetenus(transcripts: readonly ResultatRecherche[]): ResultatRecherche[] {
    const connues = this.sessionsConnues();
    const compte = new Map<string, number>();
    const triees = [...transcripts].sort((a, b) => b.ts.localeCompare(a.ts));
    return triees.filter((r) => {
      const cle = `${r.machine}|${r.sessionId}`;
      const n = compte.get(cle) ?? 0;
      if (connues.has(cle) || n >= PAR_SESSION) return false;
      compte.set(cle, n + 1);
      return true;
    });
  }

  private sessionsConnues(): Set<string> {
    const ids = new Set<string>();
    for (const s of this.d.registre.sessions(true)) {
      ids.add(`${s.machine}|${s.id}`);
      if (s.claudeSessionId) ids.add(`${s.machine}|${s.claudeSessionId}`);
    }
    return ids;
  }
}

function echec(machine: string, raison: string): Interrogation {
  return { machine: { machine, joignable: false, erreur: raison }, resultats: [] };
}

function demandeMemoire(p: URLSearchParams): { outil: OutilMemoire; projet?: string; jours: number } | string {
  const outil = OUTILS_MEMOIRE.find((o) => o === p.get('outil'));
  if (!outil) return 'outil de mémoire inconnu';
  const projet = (p.get('projet') ?? '').trim();
  if (projet.length > LONGUEUR_MAX_PROJET) return 'projet trop long';
  if (outil === 'fiche' && projet === '') return 'projet attendu pour la fiche';
  const jours = Math.min(JOURS_MAX, Math.max(1, entier(p.get('jours'), JOURS_DEFAUT)));
  return projet === '' ? { outil, jours } : { outil, projet, jours };
}

// Une attente bornée : la réponse tardive du poste est ignorée (son délai de 60 s la rend sans effet).
export async function avecDelai<T>(attente: Promise<T>, ms: number): Promise<T | typeof DELAI> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<typeof DELAI>((resoudre) => {
    minuterie = setTimeout(() => resoudre(DELAI), ms);
  });
  try {
    return await Promise.race([attente, delai]);
  } finally {
    clearTimeout(minuterie);
  }
}
