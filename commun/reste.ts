// Responsabilité : le vocabulaire de la vague « reste » partagé par le poste et le relais — extrait autour d'une
// occurrence (recherche), mémoire Hippocampe lue, jetons d'une session, commandes Claude d'une machine.
import { z } from 'zod';

export const IDENTIFIANT_SESSION = /^[A-Za-z0-9-]{1,100}$/;
export const LONGUEUR_EXTRAIT = 200;
export const LONGUEUR_MAX_REQUETE = 200;
export const LIMITE_RECHERCHE_MAX = 50;
export const NOM_COMMANDE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_DESCRIPTION_COMMANDE = 300;
export const MAX_CONTENU_COMMANDE = 20000;
/** Code renvoyé par le poste quand le fichier de la commande existe déjà (jamais d'écrasement). */
export const ERREUR_COMMANDE_EXISTANTE = 'commande_existante';

export const OUTILS_MEMOIRE = ['fiche', 'recap', 'projets'] as const;
export type OutilMemoire = (typeof OUTILS_MEMOIRE)[number];

export interface Extrait {
  readonly extrait: string;
  readonly debut: number;
  readonly longueur: number;
}

/** Une occurrence trouvée dans le texte d'un message (Chris ou Claude), telle que le relais la rend. */
export interface ResultatRecherche {
  readonly sessionId: string;
  readonly machine: string;
  readonly titre: string;
  readonly dossier: string;
  readonly ts: string;
  readonly role: 'chris' | 'claude';
  readonly extrait: string;
  readonly debut: number;
  readonly longueur: number;
  readonly seq: number | null;
  readonly source: 'relais' | 'transcript';
}

/** Une occurrence du registre du relais (même forme, `seq` rempli, sans source). */
export type RencontreMessage = Omit<ResultatRecherche, 'source'> & { readonly seq: number };

export const ResultatTranscript = z.object({
  sessionId: z.string().regex(IDENTIFIANT_SESSION),
  dossier: z.string(),
  titre: z.string(),
  ts: z.string(),
  role: z.enum(['chris', 'claude']),
  extrait: z.string(),
  debut: z.number().int().nonnegative(),
  longueur: z.number().int().nonnegative(),
});
export type ResultatTranscript = z.infer<typeof ResultatTranscript>;

export const ResultatsTranscripts = z.object({ resultats: z.array(ResultatTranscript) });
export type ResultatsTranscripts = z.infer<typeof ResultatsTranscripts>;

export const ReponseMemoire = z.discriminatedUnion('etat', [
  z.object({ etat: z.literal('ok'), outil: z.enum(OUTILS_MEMOIRE), texte: z.string() }),
  z.object({ etat: z.literal('absente'), raison: z.string() }),
  z.object({ etat: z.literal('erreur'), raison: z.string() }),
]);
export type ReponseMemoire = z.infer<typeof ReponseMemoire>;

export interface JetonsSession {
  readonly entree: number;
  readonly sortie: number;
  readonly tours: number;
  readonly cout?: number; // coût cumulé, si la dernière fin de tour le porte (session suivie hors de Lanterne)
}

export const CommandeMachine = z.object({
  nom: z.string(),
  description: z.string(),
  chemin: z.string(),
});
export type CommandeMachine = z.infer<typeof CommandeMachine>;

export const ListeCommandes = z.object({ commandes: z.array(CommandeMachine) });
export type ListeCommandes = z.infer<typeof ListeCommandes>;

/** Les commandes de la vague « reste » du relais vers un poste (ajoutées à `CommandeRelais`). */
export const commandesReste = [
  z.object({
    kind: z.literal('rechercher_transcripts'),
    id: z.string(),
    texte: z.string().min(2).max(LONGUEUR_MAX_REQUETE),
    limite: z
      .number()
      .int()
      .min(1)
      .max(LIMITE_RECHERCHE_MAX + 1),
  }),
  z.object({
    kind: z.literal('memoire_lire'),
    id: z.string(),
    outil: z.enum(OUTILS_MEMOIRE),
    projet: z.string().min(1).max(200).optional(),
    jours: z.number().int().min(1).max(365).optional(),
  }),
  z.object({ kind: z.literal('commandes_lister'), id: z.string() }),
  z.object({
    kind: z.literal('commande_creer'),
    id: z.string(),
    nom: z.string().regex(NOM_COMMANDE),
    description: z.string().max(MAX_DESCRIPTION_COMMANDE),
    contenu: z.string().min(1).max(MAX_CONTENU_COMMANDE),
  }),
];

export const GENRES_RESTE = ['rechercher_transcripts', 'memoire_lire', 'commandes_lister', 'commande_creer'] as const;

/** Espaces (y compris retours à la ligne) réduits à un seul espace, bords coupés. */
export function normaliserEspaces(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim();
}

/** La requête telle qu'elle apparaît dans un fichier JSON(L) : guillemets, antislashes et contrôles échappés. */
export function echappementJson(requete: string): string {
  return JSON.stringify(normaliserEspaces(requete)).slice(1, -1);
}

/**
 * Motif LIKE (échappement `!`) qui préfiltre une ligne JSON contenant la requête, sans casse pour l'ASCII. Un caractère
 * non ASCII devient `_` (un caractère quelconque) : la casse des lettres accentuées n'est donc pas filtrée ici.
 */
export function motifLike(requete: string): string {
  let motif = '';
  for (const c of echappementJson(requete)) {
    if (c.charCodeAt(0) > 127) motif += '_';
    else if ('%_!'.includes(c)) motif += `!${c}`;
    else motif += c;
  }
  return `%${motif}%`;
}

/**
 * Extrait d'au plus `LONGUEUR_EXTRAIT` caractères autour de la première occurrence de la requête (sans casse, espaces
 * normalisés), « … » aux bords coupés. Null si le texte ne contient pas la requête.
 */
export function extraitAutour(texte: string, requete: string): Extrait | null {
  const aiguille = normaliserEspaces(requete).toLocaleLowerCase();
  if (aiguille === '') return null;
  const base = normaliserEspaces(texte);
  const { minuscules, origine } = indexerCasse(base);
  const a = minuscules.indexOf(aiguille);
  if (a < 0) return null;
  return fenetre(base, origine[a] ?? 0, origine[a + aiguille.length] ?? base.length);
}

// Chaque unité de la version en minuscules rattachée à l'index, dans `base`, du caractère d'origine : la casse peut
// changer la longueur d'un texte, les positions restent ainsi justes.
function indexerCasse(base: string): { minuscules: string; origine: number[] } {
  let minuscules = '';
  const origine: number[] = [];
  let i = 0;
  for (const c of base) {
    const bas = c.toLocaleLowerCase();
    for (let k = 0; k < bas.length; k++) origine.push(i);
    minuscules += bas;
    i += c.length;
  }
  origine.push(base.length);
  return { minuscules, origine };
}

const estSurrogateBas = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

function fenetre(base: string, s: number, e: number): Extrait {
  const budget = LONGUEUR_EXTRAIT - 2; // place réservée aux deux « … »
  const coeur = Math.min(e - s, budget);
  const fin = s + coeur;
  const reste = budget - coeur;
  let avant = Math.min(s, Math.floor(reste / 2));
  const apres = Math.min(base.length - fin, reste - avant);
  avant = Math.min(s, reste - apres);
  let debutW = s - avant;
  let finW = fin + apres;
  if (debutW > 0 && estSurrogateBas(base.charCodeAt(debutW))) debutW++;
  if (finW < base.length && estSurrogateBas(base.charCodeAt(finW))) finW--;
  const pref = debutW > 0 ? '…' : '';
  const suf = finW < base.length ? '…' : '';
  return { extrait: `${pref}${base.slice(debutW, finW)}${suf}`, debut: pref.length + s - debutW, longueur: coeur };
}
