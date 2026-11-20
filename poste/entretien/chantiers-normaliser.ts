// Responsabilité : ramener un fichier de suivi d'agent (formats hétérogènes, écrits par les agents) à la forme commune
// des chantiers. Pur : aucune lecture de disque.
import type { ChantierPoste } from '../../commun/entretien.ts';

const MAX_FAITS = 20;
const MAX_TEXTE = 300;

const EN_COURS = new Set(['en_cours', 'running', 'in_progress', 'actif', 'construction', 'en_construction']);
const TERMINE = new Set(['termine', 'termine_partiel', 'done', 'fini', 'completed', 'livre', 'complete']);
const ECHEC = new Set(['echec', 'erreur', 'failed', 'error', 'bloque']);

type Objet = Record<string, unknown>;

/** Libellé ramené en minuscules sans accents, espaces et tirets devenus `_` : « En cours » → « en_cours ». */
function libelle(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function statutDe(brut: string | null): ChantierPoste['statut'] {
  if (brut === null) return 'inconnu';
  const cle = libelle(brut);
  if (EN_COURS.has(cle)) return 'en_cours';
  if (TERMINE.has(cle)) return 'termine';
  if (ECHEC.has(cle)) return 'echec';
  return 'inconnu';
}

/** Première valeur chaîne présente parmi les clés données (dans l'ordre de préférence). */
function texte(o: Objet, cles: readonly string[]): string | null {
  for (const cle of cles) {
    const v = o[cle];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Une étape : la chaîne donnée, ou la dernière d'un tableau d'étapes. */
function etapeDe(o: Objet): string | null {
  const directe = texte(o, ['etape', 'step']);
  if (directe) return directe;
  const liste = o['etapes'];
  if (!Array.isArray(liste)) return null;
  const chaines = liste.filter((e): e is string => typeof e === 'string' && e.trim() !== '');
  return chaines.at(-1)?.trim() ?? null;
}

/** Les faits : fait, notes ou etapes (chaîne seule ou tableau), 20 au plus, 300 caractères chacun. */
function faitsDe(o: Objet): string[] {
  const source = o['fait'] ?? o['notes'] ?? o['etapes'];
  const liste = typeof source === 'string' ? [source] : Array.isArray(source) ? source : [];
  return liste
    .filter((f): f is string => typeof f === 'string' && f.trim() !== '')
    .slice(0, MAX_FAITS)
    .map((f) => f.slice(0, MAX_TEXTE));
}

/** Un fichier de suivi lu : `null` si ce n'est pas un objet. `majLe` = date de modification du fichier. */
export function normaliserChantier(fichier: string, brut: unknown, majLe: string): ChantierPoste | null {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return null;
  const o = brut as Objet;
  const statutBrut = texte(o, ['statut', 'etat', 'status']);
  return {
    fichier,
    agent: texte(o, ['agent', 'model']),
    projet: texte(o, ['projet', 'project']),
    statut: statutDe(statutBrut),
    statutBrut,
    mission: texte(o, ['mission', 'titre', 'tache', 'task', 'slug']),
    etape: etapeDe(o),
    fait: faitsDe(o),
    majLe,
  };
}
