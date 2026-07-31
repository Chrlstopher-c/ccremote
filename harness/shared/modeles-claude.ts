/**
 * Responsabilité : LA liste unique des modèles Claude pilotables et, pour
 * chacun, les niveaux d'effort qu'il accepte réellement.
 *
 * `☠ VÉCU LE 31/07` — `dispatch-mandat.ts` faisait `p.modele ?? DEFAUT` et
 * passait la chaîne telle quelle au CLI. L'orchestrateur, à qui l'opérateur
 * avait dit « sonnet 5 », a dispatché le modèle `"sonnet 5"` — avec l'espace.
 * Le CLI attend un alias (`opus`, `sonnet`, `fable`) ou un identifiant complet
 * (`claude-sonnet-5`) : l'équipe est morte deux secondes après son démarrage sur
 * « There's an issue with the selected model (sonnet 5) ». Rien ne validait
 * l'entrée, alors qu'elle vient d'un LLM qui écrit en langage naturel.
 *
 * `☠` Un refus AVANT dispatch vaut infiniment mieux qu'un échec après :
 * l'orchestrateur est un modèle, il corrige tout seul si on lui rend la liste
 * des valeurs acceptées. Un mandat mort ne lui apprend rien.
 *
 * `☠` La liste des efforts n'est PAS uniforme. Tout mettre à
 * `low|medium|high|xhigh|max` afficherait à l'écran des options qui échouent :
 * `xhigh` n'existe pas avant Opus 4.7, et Haiku n'accepte aucun effort.
 */

/** Niveaux d'effort, du plus économe au plus profond. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

/** Sans `xhigh` : ce niveau est apparu avec Opus 4.7. */
const EFFORTS_SANS_XHIGH: readonly Effort[] = ['low', 'medium', 'high', 'max'];
const EFFORTS_COMPLETS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface ModeleClaude {
  /** Identifiant canonique, celui qu'on passe au CLI. */
  readonly id: string;
  /** Nom lisible à l'écran. */
  readonly libelle: string;
  /** Alias court accepté par le CLI (`opus`, `sonnet`…), quand il en existe un. */
  readonly alias: string | null;
  /** `☠` Vide = ce modèle REFUSE le paramètre d'effort (cas de Haiku). */
  readonly efforts: readonly Effort[];
  /** Effort à proposer par défaut à l'écran. `null` si le modèle n'en accepte pas. */
  readonly effortDefaut: Effort | null;
  /** `☠` Le mode rapide de Claude Code n'existe QUE sur la famille Opus récente. */
  readonly modeRapide: boolean;
  readonly note: string;
}

/**
 * `☠ CE CATALOGUE EST UN REPLI, PAS LA SOURCE D'AUTORITÉ.` La vraie liste est
 * `supportedModels()` du SDK, qui rend `supportedEffortLevels`,
 * `supportsFastMode` et `supportsAdaptiveThinking` pour le compte RÉELLEMENT
 * connecté. Il faut une session vivante pour l'interroger : ce catalogue sert
 * quand il n'y en a pas, et ne doit jamais la contredire.
 *
 * `☠` Contenu ALIGNÉ SUR LA MESURE du 2026-07-31 (`acceptation/modeles-effort-
 * reel.ts`, sous SDK 0.3.220 / CLI 2.1.220). La liste dépend de la version du
 * CLI EMBARQUÉE PAR LE SDK, pas du compte ni de l'abonnement : sous le SDK
 * 0.3.217 (CLI 2.1.217) `supportedModels()` rendait `claude-opus-4-8` et
 * ignorait `claude-opus-5` — sur les deux comptes, à l'identique. Monter le SDK
 * a fait apparaître Opus 5 et disparaître Opus 4.8.
 *
 * `☠` Conséquence : proposer à l'écran un modèle absent de `supportedModels()`
 * produit une option qui échoue au dispatch. Toute mise à jour du SDK doit être
 * suivie d'un passage du banc, et de la mise à jour de ce repli.
 */
export const MODELES: readonly ModeleClaude[] = [
  {
    id: 'claude-opus-5',
    libelle: 'Opus 5',
    alias: 'opus',
    efforts: EFFORTS_COMPLETS,
    // `☠` MESURÉ : seul modèle à déclarer `supportsFastMode`.
    modeRapide: true,
    effortDefaut: 'high',
    note: 'Le plus capable pour le code et les missions longues. Seul à déclarer le mode rapide.',
  },
  {
    id: 'claude-sonnet-5',
    libelle: 'Sonnet 5',
    alias: 'sonnet',
    efforts: EFFORTS_COMPLETS,
    modeRapide: false,
    effortDefaut: 'high',
    note: 'Proche d’Opus sur le code, nettement moins cher.',
  },
  {
    id: 'claude-fable-5',
    libelle: 'Fable 5',
    alias: 'fable',
    efforts: EFFORTS_COMPLETS,
    modeRapide: false,
    effortDefaut: 'high',
    note: 'Le plus capable, tarif au-dessus d’Opus. Réflexion toujours active.',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    libelle: 'Haiku 4.5',
    alias: 'haiku',
    // `☠` MESURÉ : `supportsEffort: false`, aucun niveau déclaré. Lui proposer un
    // effort à l'écran afficherait une option que le SDK ignore en silence.
    efforts: [],
    modeRapide: false,
    effortDefaut: null,
    note: 'Le plus rapide et le moins cher. N’accepte aucun niveau d’effort.',
  },
];

/** Familles acceptées telles quelles par le CLI, sans version. */
const ALIAS_NUS: readonly string[] = MODELES.map((m) => m.alias).filter((a): a is string => a !== null);

/**
 * `☠` Le CLI accepte un suffixe de variante entre crochets (`opus[1m]`, vu dans
 * les réglages réels). On le préserve : le retirer changerait la fenêtre de
 * contexte du worker sans que personne ne l'ait demandé.
 */
const SUFFIXE_VARIANTE = /(\[[^\]]+\])$/;

/** `sonnet 5`, `Sonnet-5`, `sonnet_5` ⇒ famille `sonnet`, version `5`. */
const FAMILLE_ET_VERSION = /^(opus|sonnet|haiku|fable|mythos)[\s._-]*(\d+(?:[.\-_]\d+)?)$/;

function canoniser(famille: string, version: string): string {
  return `claude-${famille}-${version.replace(/[._]/g, '-')}`;
}

/**
 * Rend l'identifiant canonique d'un modèle, ou `null` si la valeur ne désigne
 * rien de reconnaissable.
 *
 * Accepte : un alias nu (`opus`), un identifiant complet (`claude-sonnet-5`),
 * et les formes en langage naturel qu'un modèle produit spontanément
 * (`sonnet 5`, `Opus 4.8`) — c'est précisément la panne du 31/07.
 */
export function normaliserModele(brut: string): string | null {
  const nettoye = brut.trim().toLowerCase();
  if (nettoye.length === 0) return null;

  const variante = SUFFIXE_VARIANTE.exec(nettoye)?.[1] ?? '';
  const base = variante === '' ? nettoye : nettoye.slice(0, -variante.length).trim();

  if (ALIAS_NUS.includes(base)) return `${base}${variante}`;
  if (base.startsWith('claude-')) return `${base}${variante}`;

  const correspondance = FAMILLE_ET_VERSION.exec(base);
  const famille = correspondance?.[1];
  const version = correspondance?.[2];
  if (famille !== undefined && version !== undefined) return `${canoniser(famille, version)}${variante}`;

  return null;
}

/**
 * `☠` Suffixe de DATE d'un identifiant figé (`claude-haiku-4-5-20251001`). Le
 * CLI accepte les deux formes ; le catalogue n'en porte qu'une, et sans cette
 * tolérance `claude-haiku-4-5` ne serait pas reconnu — Haiku se verrait alors
 * proposer des niveaux d'effort qu'il refuse.
 */
const SUFFIXE_DATE = /-\d{8}$/;

function cle(id: string): string {
  return id.replace(SUFFIXE_VARIANTE, '').replace(SUFFIXE_DATE, '');
}

/** Le modèle du catalogue correspondant à cet identifiant, variante et date ignorées. */
export function trouverModele(id: string): ModeleClaude | undefined {
  const recherche = cle(id);
  return MODELES.find((m) => cle(m.id) === recherche || m.alias === recherche);
}

/**
 * Les efforts acceptés par ce modèle. `☠` Modèle inconnu ⇒ on rend la liste
 * complète plutôt que rien : refuser un effort sur une ignorance coûterait une
 * capacité réelle, et le CLI tranchera de toute façon.
 */
export function effortsDe(id: string): readonly Effort[] {
  return trouverModele(id)?.efforts ?? EFFORTS_COMPLETS;
}

/** Message de refus destiné à l'orchestrateur : il doit pouvoir se corriger seul. */
export function messageModeleInconnu(brut: string): string {
  const valeurs = MODELES.map((m) => (m.alias === null ? m.id : `${m.id} (ou « ${m.alias} »)`)).join(', ');
  return (
    `modèle « ${brut} » non reconnu — le CLI attend un alias ou un identifiant complet, ` +
    `jamais un libellé en langage naturel. Valeurs acceptées : ${valeurs}.`
  );
}
