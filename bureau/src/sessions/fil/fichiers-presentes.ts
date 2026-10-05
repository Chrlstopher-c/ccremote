// Responsabilité : quels fichiers un appel d'outil PRÉSENTE à Chris (images lues, fichiers envoyés, captures écrites),
// pour les montrer dans le fil au lieu de laisser Chris « aveugle ». Pur.
import { apercuDe, type Apercu } from '../../appareils/fichiers/genre.ts';

const MAX_PAR_OUTIL = 6;
const LECTURE_ECRITURE = new Set(['Read', 'Write']);
const SEULEMENT_VISUELS = new Set<Apercu>(['image', 'pdf']); // un Read de code n'est pas une présentation
const PRESENTABLES = new Set<Apercu>(['image', 'video', 'audio', 'pdf', 'markdown']);

const estTexte = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Les chemins absolus (relatifs au dossier de la session sinon) à montrer pour cet appel d'outil. */
export function cheminsPresentes(outil: string, detail: string, dossier: string): string[] {
  let entree: unknown;
  try {
    entree = JSON.parse(detail);
  } catch {
    return [];
  }
  if (typeof entree !== 'object' || entree === null) return [];
  const e = entree as Record<string, unknown>;
  const bruts: string[] = Array.isArray(e['files']) ? e['files'].filter(estTexte) : [];
  if (LECTURE_ECRITURE.has(outil) && estTexte(e['file_path'])) bruts.push(e['file_path']);
  const admis = LECTURE_ECRITURE.has(outil) ? SEULEMENT_VISUELS : PRESENTABLES;
  const absolus = bruts.map((c) => (c.startsWith('/') || !dossier ? c : `${dossier}/${c}`));
  return [...new Set(absolus)]
    .filter((c) => c.startsWith('/') && admis.has(apercuDe(c.slice(c.lastIndexOf('/') + 1))))
    .slice(0, MAX_PAR_OUTIL);
}
