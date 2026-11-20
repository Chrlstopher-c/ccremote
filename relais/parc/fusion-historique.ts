// Responsabilité : fusion d'une relecture de transcript dans le fil d'une session. Deux modes. Suite : seul ce qui suit
// le dernier événement connu du fil s'ajoute (ancre). Complète (relecture demandée par le relais) : chaque événement
// absent du fil (clé de dédoublonnage) prend sa place chronologique, comblant les trous. Clé d'un événement : le
// contenu porte l'uuid de la ligne du transcript pour les messages et textes, l'identifiant pour les appels d'outils.
import type { Evenement } from '../../commun/session.ts';

export interface EvenementHorodate {
  readonly ts: string;
  readonly evt: Evenement;
}

/** Ligne du fil existante (rang en base) ou ajoutée par la fusion (rang `null`). */
export interface LigneFil extends EvenementHorodate {
  readonly seq: number | null;
  readonly cle: string;
}

/** État d'une relecture en cours : `ancre` = clé du dernier événement du fil, à retrouver dans les lots qui suivent. */
export interface EtatRelecture {
  readonly replay: string;
  readonly ancre: string | null; // null : tout ce qui suit s'ajoute au fil
  readonly fusion: boolean; // la relecture s'ajoute à un fil déjà rempli (ses ajouts sont diffusés en direct)
  readonly complet?: boolean; // relecture complète demandée par le relais : fusion chronologique
}

export function cleEvenement(e: EvenementHorodate): string {
  return `${e.ts}\u0000${JSON.stringify(e.evt)}`;
}

/** Clé de dédoublonnage : l'uuid de la ligne du transcript (messages, textes), l'identifiant d'un appel ou d'un résultat
 * d'outil, sinon le contenu horodaté. Un texte et un message d'une même ligne partagent l'uuid : le texte les distingue. */
export function cleDeDoublon(e: EvenementHorodate): string {
  const evt = e.evt;
  if ((evt.type === 'message' || evt.type === 'texte') && evt.uuid) {
    return `${evt.type}\u0000${evt.uuid}\u0000${evt.texte}`;
  }
  if (evt.type === 'outil' || evt.type === 'sous_agent') return `${evt.type}\u0000${evt.id}`;
  if (evt.type === 'resultat_outil') return `resultat_outil\u0000${evt.outilId}`;
  return cleEvenement(e);
}

/** Vrai pour un événement issu d'une ligne du transcript (absent d'un fil écrit en direct sans uuid). */
export function estLigneDuTranscript(evt: Evenement): boolean {
  if (evt.type === 'message' || evt.type === 'texte') return Boolean(evt.uuid);
  return evt.type === 'outil' || evt.type === 'sous_agent' || evt.type === 'resultat_outil';
}

function rangDe(lot: readonly EvenementHorodate[], ancre: string): number {
  for (let i = lot.length - 1; i >= 0; i--) {
    const e = lot[i];
    if (e && cleEvenement(e) === ancre) return i;
  }
  return -1;
}

/** Ce qui s'ajoute au fil pour un lot. Ancre absente de ce lot → rien, on attend le lot suivant. */
export function suiteAjoutee(
  ancre: string | null,
  lot: readonly EvenementHorodate[],
): { readonly ancre: string | null; readonly ajout: readonly EvenementHorodate[] } {
  if (ancre === null) return { ancre: null, ajout: lot };
  const rang = rangDe(lot, ancre);
  if (rang >= 0) return { ancre: null, ajout: lot.slice(rang + 1) };
  // Ancre introuvable par son contenu (fil importé par une version qui n'écrivait pas l'uuid de la ligne) : si le lot
  // couvre son heure, la suite est ce qui est strictement postérieur.
  const heure = heureDe(ancre);
  const premier = lot[0];
  const suite = lot.filter((e) => e.ts > heure);
  if (premier === undefined || premier.ts > heure || suite.length === 0) return { ancre, ajout: [] };
  return { ancre: null, ajout: suite };
}

/** Vrai quand le lot commence après l'ancre du fil : il manque le milieu, seule une relecture complète le comble. */
export function queueSansAncre(ancre: string | null, lot: readonly EvenementHorodate[]): boolean {
  const premier = lot[0];
  return ancre !== null && premier !== undefined && premier.ts > heureDe(ancre);
}

function heureDe(cle: string): string {
  return cle.slice(0, cle.indexOf('\u0000'));
}

/** Un lot de la relecture `replay` (mode suite) : une nouvelle relecture part de l'ancre du fil (lue à ce moment). */
export function avancerRelecture(
  precedent: EtatRelecture | undefined,
  replay: string,
  ancreDuFil: () => string | null,
  lot: readonly EvenementHorodate[],
): { readonly etat: EtatRelecture; readonly ajout: readonly EvenementHorodate[] } {
  if (precedent !== undefined && precedent.replay === replay) {
    const suite = suiteAjoutee(precedent.ancre, lot);
    return { etat: { replay, ancre: suite.ancre, fusion: precedent.fusion }, ajout: suite.ajout };
  }
  const ancre = ancreDuFil();
  const suite = suiteAjoutee(ancre, lot);
  return { etat: { replay, ancre: suite.ancre, fusion: ancre !== null }, ajout: suite.ajout };
}

export interface PlanFusion {
  readonly fil: readonly LigneFil[]; // le fil après fusion, dans l'ordre d'affichage
  readonly premierDeplace: number; // rang du premier événement existant qui change de place ; -1 : rien ne bouge
}

/** Identifiants d'un lot (uuid des messages et textes, id des appels, id des résultats) : pour retrouver au fil ses lignes,
 * même loin dans le temps (un résultat d'outil de tâche de fond n'a pas l'heure de son appel). */
export function identifiantsDuLot(lot: readonly EvenementHorodate[]): { uuids: string[]; ids: string[] } {
  const uuids = new Set<string>();
  const ids = new Set<string>();
  for (const { evt } of lot) {
    if ((evt.type === 'message' || evt.type === 'texte') && evt.uuid) uuids.add(evt.uuid);
    else if (evt.type === 'outil' || evt.type === 'sous_agent') ids.add(evt.id);
    else if (evt.type === 'resultat_outil') ids.add(evt.outilId);
  }
  return { uuids: [...uuids], ids: [...ids] };
}

/** Fusion pure : chaque événement du lot absent du fil (clé inconnue) prend sa place chronologique (après les
 * événements de même horodatage ou antérieurs). Les lignes existantes gardent leur ordre ; si l'une d'elles est
 * décalée, toute la suite du fil doit être réécrite en base. */
export function planifierFusion(
  existants: readonly LigneFil[],
  lot: readonly EvenementHorodate[],
  dejaAuFil: ReadonlySet<string> = new Set(),
): PlanFusion {
  const connues = new Set([...existants.map((l) => l.cle), ...dejaAuFil]);
  const fil: LigneFil[] = [...existants];
  for (const e of lot) {
    const cle = cleDeDoublon(e);
    if (connues.has(cle)) continue;
    connues.add(cle);
    let rang = fil.length;
    while (rang > 0 && (fil[rang - 1]?.ts ?? '') > e.ts) rang--;
    fil.splice(rang, 0, { ts: e.ts, evt: e.evt, seq: null, cle });
  }
  const premierDeplace = fil.findIndex((l, i) => i < existants.length && l !== existants[i]);
  return { fil, premierDeplace };
}
