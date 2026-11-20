// Responsabilité : assembler la vue complète d'un compte (DetailCompte) à partir des réponses brutes de l'API Anthropic
// (profil, usage, usage avec cedar_ember, crédits prépayés) et de la session SDK. Pur : rien n'est lu ni écrit ;
// une valeur mal formée devient null ou un tableau vide, jamais une exception.
import type { DetailCompte, FenetreBrute, LigneLimite, UsageSdk } from '../../commun/compte-detail.ts';
import { lireReinitialisations } from './detail-reinitialisations.ts';
import {
  lireCredits,
  lireDepenses,
  lireParts,
  lireProfil,
  lireRepartition,
  lireUsageSupplementaire,
} from './detail-facturation.ts';
import { chemin, estObjet, nombre, objet, objetOuNull, tableau, texte, type Objet } from './valeurs.ts';

export interface EntreesDetail {
  readonly compte: string;
  readonly machine: string;
  readonly releveLe: string;
  readonly profil: unknown | null;
  readonly usage: unknown | null;
  readonly usageCedar: unknown | null;
  readonly prepaye: unknown | null;
  readonly sdk: UsageSdk | null;
  readonly problemes: string[];
}

// Clés de l'usage lues ailleurs : hors des fenêtres et de « autres ».
const CLES_LUES: ReadonlySet<string> = new Set([
  'limits',
  'extra_usage',
  'spend',
  'seven_day_breakdown',
  'weekly_scoped_shares',
  'cedar_ember',
]);

function fenetre(cle: string, v: Objet): FenetreBrute {
  return {
    cle,
    pourcent: nombre(v['utilization']),
    reinitialiseLe: texte(v['resets_at']),
    limiteDollars: nombre(v['limit_dollars']),
    utiliseDollars: nombre(v['used_dollars']),
    resteDollars: nombre(v['remaining_dollars']),
    raisonBlocage: texte(v['locked_reason']),
  };
}

const estFenetre = (cle: string, v: unknown): v is Objet =>
  !CLES_LUES.has(cle) && estObjet(v) && 'utilization' in v;

function fenetresDe(usage: Objet): FenetreBrute[] {
  return Object.entries(usage)
    .filter((entree): entree is [string, Objet] => estFenetre(entree[0], entree[1]))
    .map(([cle, v]) => fenetre(cle, v));
}

function ligneLimite(v: unknown): LigneLimite[] {
  if (!estObjet(v)) return [];
  const genre = texte(v['kind']);
  const pourcent = nombre(v['percent']);
  if (genre === null || pourcent === null) return [];
  return [
    {
      genre,
      groupe: texte(v['group']) ?? '',
      pourcent,
      gravite: texte(v['severity']) ?? 'inconnue',
      reinitialiseLe: texte(v['resets_at']),
      modele: texte(chemin(v, 'scope', 'model', 'display_name')),
      surface: texte(chemin(v, 'scope', 'surface', 'display_name')),
      active: v['is_active'] === true,
    },
  ];
}

function limitesDe(usage: Objet): LigneLimite[] {
  return tableau(usage['limits']).flatMap(ligneLimite);
}

function autresDe(usage: Objet): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(usage).filter(([cle, v]) => v !== null && !CLES_LUES.has(cle) && !estFenetre(cle, v)),
  );
}

export function lireDetail(e: EntreesDetail): DetailCompte {
  const usage = objet(e.usage);
  return {
    compte: e.compte,
    machine: e.machine,
    releveLe: e.releveLe,
    probleme: e.problemes.length > 0 ? e.problemes.join(' ; ') : null,
    profil: lireProfil(e.profil),
    limites: limitesDe(usage),
    fenetres: fenetresDe(usage),
    usageSupplementaire: lireUsageSupplementaire(usage['extra_usage']),
    depenses: lireDepenses(usage['spend']),
    creditsPrepayes: lireCredits(e.prepaye),
    repartitionSemaine: lireRepartition(usage['seven_day_breakdown']),
    partsModeles: lireParts(usage['weekly_scoped_shares']),
    reinitialisations: lireReinitialisations(objetOuNull(e.usageCedar)?.['cedar_ember']),
    sdk: e.sdk,
    autres: autresDe(usage),
  };
}
