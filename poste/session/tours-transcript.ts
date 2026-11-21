// Responsabilité : les tours d'une session lue dans son transcript (hors Lanterne), au même format que le `tour_fini` du
// SDK. Un tour se termine avec sa réponse : une ligne `assistant` au `stop_reason` `end_turn` (une réponse s'écrit sur
// plusieurs lignes, une par bloc : le tour est clos à la première ligne qui n'en fait pas partie), ou à sa ligne
// `system/turn_duration` quand le transcript en porte une. Ses jetons sont ceux de ses messages assistant, comptés une
// fois par identifiant de message. Les fichiers écrits pendant le tour partent juste avant `tour_fini`, comme au SDK.
// Le coût cumulé (`cost-state`) n'est joint au tour que s'il est postérieur à sa dernière réponse. Une fin de tour sans
// réponse ne compte pas. L'état court d'une ligne à la suivante : la relecture complète et le suivi incrémental donnent
// les mêmes événements. Pur.
import type { Evenement } from '../../commun/session.ts';
import { type AppelEcriture, type EditionFichier, editionDe, OUTILS_ECRITURE } from './tours-edition.ts';
import { contexteDe, estErreurApi, type Ligne } from './traduction.ts';

type TourFini = Extract<Evenement, { type: 'tour_fini' }>;
type FichierTour = Extract<Evenement, { type: 'fichiers_tour' }>['fichiers'][number];
type Objet = Record<string, unknown>;

export class CompteTours {
  private messagesVus = new Set<string>();
  private reponses = 0;
  private entree = 0;
  private sortie = 0;
  private derniereEntree: string | null = null;
  private contexte = 0; // dernier contexte lu, gardé d'un tour à l'autre
  private enFin: string | null = null; // message dont la réponse s'est terminée (end_turn) : le tour se clôt à la suite
  private finLe: number | null = null; // horodatage de la dernière ligne de cette réponse
  private debutLe: number | null = null; // horodatage de la demande de Chris qui a lancé le tour
  private readonly appels = new Map<string, AppelEcriture>(); // écritures appelées, en attente de leur résultat
  private fichiers = new Map<string, FichierTour>();
  private coutLu: number | null = null; // dernier `cost-state` lu
  private coutApres = false; // ce `cost-state` vient après la dernière réponse

  /** Événements de fin de tour produits par cette ligne (fichiers du tour, puis `tour_fini`). */
  ligne(l: Ligne): Evenement[] {
    if (l.isSidechain === true) return [];
    if (l.type === 'cost-state') {
      this.lire(l);
      return [];
    }
    const fin = this.enFin !== null && !suiteDeLaReponse(l, this.enFin) ? this.cloture(this.dureeDe(l)) : [];
    this.lire(l);
    if (l.type === 'system' && l.subtype === 'turn_duration') return [...fin, ...this.cloture(nombre(l.durationMs))];
    return fin;
  }

  private lire(l: Ligne): void {
    if (l.type === 'assistant') this.reponse(l);
    else if (l.type === 'user' && l.isMeta !== true) this.utilisateur(l);
    else if (l.type === 'cost-state' && typeof l.totalCostUSD === 'number') {
      this.coutLu = l.totalCostUSD;
      this.coutApres = true;
    }
  }

  private reponse(l: Ligne): void {
    this.coutApres = false;
    if (estErreurApi(l)) return;
    const cle = typeof l.message?.id === 'string' ? l.message.id : null;
    this.reponses += 1;
    if (cle === null || !this.messagesVus.has(cle)) {
      if (cle !== null) this.messagesVus.add(cle);
      this.compter(l);
    }
    this.noterEcritures(l);
    if (typeof l.uuid === 'string') this.derniereEntree = l.uuid;
    this.contexte = contexteDe(l) ?? this.contexte;
    if (l.message?.stop_reason === 'end_turn') this.enFin = cle ?? '';
    if (this.enFin !== null) this.finLe = horodatageDe(l) ?? this.finLe;
  }

  private utilisateur(l: Ligne): void {
    const blocs = blocsDe(l.message?.content);
    const resultats = blocs.filter((b) => b['type'] === 'tool_result');
    if (resultats.length === 0) {
      if (this.reponses === 0) this.debutLe = horodatageDe(l) ?? this.debutLe;
      return;
    }
    for (const resultat of resultats) this.resultat(resultat, l.toolUseResult);
  }

  private resultat(bloc: Objet, toolUseResult: unknown): void {
    const id = typeof bloc['tool_use_id'] === 'string' ? bloc['tool_use_id'] : null;
    const appel = id === null ? undefined : this.appels.get(id);
    if (id === null || appel === undefined) return;
    this.appels.delete(id);
    const resultatOutil = objetDe(toolUseResult);
    const edition = resultatOutil === null ? null : editionDe(appel, resultatOutil);
    if (edition !== null) this.ajouterEdition(edition);
  }

  private noterEcritures(l: Ligne): void {
    for (const bloc of blocsDe(l.message?.content)) {
      if (bloc['type'] !== 'tool_use' || typeof bloc['id'] !== 'string') continue;
      const nom = typeof bloc['name'] === 'string' ? bloc['name'] : '';
      if (!OUTILS_ECRITURE.has(nom)) continue;
      const entree = objetDe(bloc['input']) ?? {};
      this.appels.set(bloc['id'], { nom, chemin: chaine(entree['file_path']) ?? chaine(entree['notebook_path']) });
    }
  }

  private ajouterEdition(e: EditionFichier): void {
    if (!e.creation && e.ajouts + e.suppressions === 0) return;
    const deja = this.fichiers.get(e.chemin);
    if (deja === undefined) {
      const etat = e.creation ? 'ajoute' : 'modifie';
      this.fichiers.set(e.chemin, {
        chemin: e.chemin,
        etat,
        ajouts: e.ajouts,
        suppressions: e.suppressions,
        binaire: false,
      });
      return;
    }
    this.fichiers.set(e.chemin, {
      ...deja,
      ajouts: deja.ajouts + e.ajouts,
      suppressions: deja.suppressions + e.suppressions,
    });
  }

  private compter(l: Ligne): void {
    const usage = l.message?.usage ?? {};
    const lus = nombre(usage['cache_read_input_tokens']) + nombre(usage['cache_creation_input_tokens']);
    this.entree += nombre(usage['input_tokens']) + lus;
    this.sortie += nombre(usage['output_tokens']);
  }

  private dureeDe(l: Ligne): number {
    if (l.type === 'system' && l.subtype === 'turn_duration') return nombre(l.durationMs);
    return this.finLe !== null && this.debutLe !== null ? Math.max(0, this.finLe - this.debutLe) : 0;
  }

  private cloture(dureeMs: number): Evenement[] {
    const sansReponse = this.reponses === 0;
    const id = this.derniereEntree;
    const fin: Evenement[] = [];
    if (!sansReponse && id !== null && this.fichiers.size > 0) {
      fin.push({ type: 'fichiers_tour', tour: id, fichiers: [...this.fichiers.values()] });
    }
    if (!sansReponse) fin.push(this.tourFini(dureeMs));
    this.remettre();
    return fin;
  }

  private tourFini(dureeMs: number): TourFini {
    const cout = this.coutApres && this.coutLu !== null ? { coutUsd: this.coutLu } : {};
    return {
      type: 'tour_fini',
      dureeMs,
      contexte: this.contexte,
      entree: this.entree,
      sortie: this.sortie,
      ...(this.derniereEntree === null ? {} : { uuid: this.derniereEntree }),
      ...cout,
    };
  }

  private remettre(): void {
    this.messagesVus.clear();
    this.reponses = 0;
    this.entree = 0;
    this.sortie = 0;
    this.derniereEntree = null;
    this.enFin = null;
    this.finLe = null;
    this.debutLe = null;
    this.fichiers = new Map();
  }
}

/** Chemins modifiés par les tours clos d'un transcript, avec la même règle que les événements `fichiers_tour`. */
export function cheminsModifies(lignes: readonly Ligne[]): string[] {
  const compte = new CompteTours();
  const chemins = new Set<string>();
  for (const l of lignes) {
    for (const evt of compte.ligne(l)) {
      if (evt.type === 'fichiers_tour') for (const f of evt.fichiers) chemins.add(f.chemin);
    }
  }
  return [...chemins];
}

// Une ligne qui suit la réponse close (end_turn) est un autre bloc du même message, ou bien elle ferme le tour.
function suiteDeLaReponse(l: Ligne, cle: string): boolean {
  return l.type === 'assistant' && (typeof l.message?.id === 'string' ? l.message.id : '') === cle;
}

function blocsDe(contenu: unknown): Objet[] {
  return Array.isArray(contenu) ? contenu.map(objetDe).filter((b): b is Objet => b !== null) : [];
}

// Objet JSON (non tableau) : la forme n'est pas contrôlée au-delà, chaque lecture la vérifie.
function objetDe(v: unknown): Objet | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Objet) : null;
}

function horodatageDe(l: Ligne): number | null {
  if (typeof l.timestamp !== 'string') return null;
  const ms = Date.parse(l.timestamp);
  return Number.isNaN(ms) ? null : ms;
}

function chaine(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function nombre(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
