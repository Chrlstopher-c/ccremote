// Responsabilité : le vocabulaire du lot 2 de la vague « reste », partagé par le poste et le relais — résumés de
// compaction (B5), demande de fusion (P3), dictée (P6), tâches planifiées (P7). Mêmes formes JSON que
// app/ui/src/reste/contrat-lot2.ts.
import { z } from 'zod';
import { CorpsServiceDictee } from './dictee-service.ts';

export const MAX_TITRE_FUSION = 256;
export const MAX_CORPS_FUSION = 65_536;
/** Audio PCM 16 bits encodé en base64 accepté dans une requête de dictée (~4 min d'audio). */
export const MAX_PCM16_BASE64 = 10_000_000;
export const LANGUE_DICTEE_DEFAUT = 'fr';
export const DELAI_FUSION_MS = 60_000;
export const DELAI_DICTEE_MS = 30_000;
export const DELAI_ETAT_DICTEE_MS = 5_000;
export const PERIODE_TACHES_MS = 30_000;
export const IDENTIFIANT_TACHE = /^[A-Za-z0-9_-]{1,100}$/;
export const MAX_NOM_TACHE = 120;
export const MAX_DOSSIER_TACHE = 1000;
export const MAX_PROMPT_TACHE = 20_000;
const MAX_MINUTES = 525_600;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const IdSession = z.string().min(1).max(200);
const DateIso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'date attendue');

// B5 — résumés de compaction lus dans le transcript de la session, plus ancien d'abord.
// `avant` / `apres` : jetons du marqueur de compaction (les mêmes que l'événement `compaction` du fil) ; null si le
// marqueur n'est pas dans le transcript.
export const ResumeCompaction = z.object({
  ts: z.string(),
  texte: z.string(),
  avant: z.number().nullish(),
  apres: z.number().nullish(),
});
export type ResumeCompaction = z.infer<typeof ResumeCompaction>;
export const Compactions = z.object({ resumes: z.array(ResumeCompaction) });
export type Compactions = z.infer<typeof Compactions>;

// P3 — demande de fusion de la branche de la session, par `gh` sur le poste.
export const DemandeFusion = z.object({
  numero: z.number().int(),
  titre: z.string(),
  url: z.string(),
  etat: z.enum(['OPEN', 'CLOSED', 'MERGED', 'DRAFT']),
});
export type DemandeFusion = z.infer<typeof DemandeFusion>;

export const EtatFusion = z.discriminatedUnion('etat', [
  z.object({ etat: z.literal('ok'), branche: z.string(), pr: DemandeFusion.nullable() }),
  z.object({ etat: z.literal('absente'), raison: z.string() }),
]);
export type EtatFusion = z.infer<typeof EtatFusion>;

export const ResultatFusion = z.discriminatedUnion('etat', [
  z.object({ etat: z.literal('ok'), pr: DemandeFusion }),
  z.object({ etat: z.literal('erreur'), raison: z.string() }),
]);
export type ResultatFusion = z.infer<typeof ResultatFusion>;

export const CorpsFusion = z.object({
  titre: z.string().trim().min(1).max(MAX_TITRE_FUSION),
  corps: z.string().max(MAX_CORPS_FUSION),
  brouillon: z.boolean(),
});
export type CorpsFusion = z.infer<typeof CorpsFusion>;

// P6 — dictée. Le poste répond pour lui-même ; le relais ajoute la machine qui a transcrit.
export const EtatDicteePoste = z.object({ disponible: z.boolean(), raison: z.string().nullable() });
export type EtatDicteePoste = z.infer<typeof EtatDicteePoste>;

export const ReponseDicteePoste = z.discriminatedUnion('etat', [
  z.object({ etat: z.literal('ok'), texte: z.string(), ms: z.number() }),
  z.object({ etat: z.literal('erreur'), raison: z.string() }),
]);
export type ReponseDicteePoste = z.infer<typeof ReponseDicteePoste>;

export const EtatDictee = z.object({
  disponible: z.boolean(),
  machine: z.string().nullable(),
  raison: z.string().nullable(),
});
export type EtatDictee = z.infer<typeof EtatDictee>;

export const ResultatDictee = z.discriminatedUnion('etat', [
  z.object({ etat: z.literal('ok'), texte: z.string(), machine: z.string(), ms: z.number() }),
  z.object({ etat: z.literal('absente'), raison: z.string() }),
  z.object({ etat: z.literal('erreur'), raison: z.string() }),
]);
export type ResultatDictee = z.infer<typeof ResultatDictee>;

export const CorpsDictee = z.object({
  pcm16: z.string().min(1).max(MAX_PCM16_BASE64),
  langue: z.string().min(2).max(10).optional(),
  machine: z.string().min(1).max(100).optional(), // machine nommée : elle transcrit si elle a le service
});
export type CorpsDictee = z.infer<typeof CorpsDictee>;

// P7 — tâches planifiées, tenues par le poste de leur machine.
export const Frequence = z.discriminatedUnion('type', [
  z.object({ type: z.literal('unique'), le: DateIso }),
  z.object({ type: z.literal('quotidienne'), heure: z.string().regex(HEURE) }),
  z.object({ type: z.literal('intervalle'), minutes: z.number().int().min(1).max(MAX_MINUTES) }),
]);
export type Frequence = z.infer<typeof Frequence>;

export const ExecutionTache = z.object({
  le: z.string(),
  session: z.string().nullable(),
  etat: z.enum(['lancee', 'echec']),
  erreur: z.string().nullable(),
});
export type ExecutionTache = z.infer<typeof ExecutionTache>;

export const TachePlanifiee = z.object({
  id: z.string(),
  nom: z.string(),
  dossier: z.string(),
  prompt: z.string(),
  modele: z.string().nullable(),
  frequence: Frequence,
  active: z.boolean(),
  derniere: ExecutionTache.nullable(),
  prochaine: z.string().nullable(),
});
export type TachePlanifiee = z.infer<typeof TachePlanifiee>;

export const TachesPlanifiees = z.object({ taches: z.array(TachePlanifiee) });
export type TachesPlanifiees = z.infer<typeof TachesPlanifiees>;

/** Corps d'une création ou d'une modification : `active` absent = inchangé (faux pour une tâche neuve). */
export const CorpsTache = z.object({
  nom: z.string().trim().min(1).max(MAX_NOM_TACHE),
  dossier: z.string().trim().min(1).max(MAX_DOSSIER_TACHE),
  prompt: z.string().trim().min(1).max(MAX_PROMPT_TACHE),
  modele: z.string().trim().min(1).max(120).nullable().optional(),
  frequence: Frequence,
  active: z.boolean().optional(),
});
export type CorpsTache = z.infer<typeof CorpsTache>;

/** Commandes du lot 2 du relais vers un poste (ajoutées à `CommandeRelais`). `id` est posé par le relais. */
export const commandesResteLot2 = [
  z.object({ kind: z.literal('compactions'), id: z.string(), sessionId: IdSession }),
  z.object({ kind: z.literal('pr_etat'), id: z.string(), sessionId: IdSession }),
  z.object({ kind: z.literal('pr_creer'), id: z.string(), sessionId: IdSession, ...CorpsFusion.shape }),
  z.object({ kind: z.literal('dictee_etat'), id: z.string() }),
  z.object({ kind: z.literal('dictee_service_etat'), id: z.string() }),
  z.object({ kind: z.literal('dictee_service'), id: z.string(), ...CorpsServiceDictee.shape }),
  z.object({
    kind: z.literal('dictee_transcrire'),
    id: z.string(),
    pcm16: z.string().min(1).max(MAX_PCM16_BASE64),
    langue: z.string().min(2).max(10),
  }),
  z.object({ kind: z.literal('taches_lister'), id: z.string() }),
  z.object({
    kind: z.literal('tache_enregistrer'),
    id: z.string(),
    tache: z.string().regex(IDENTIFIANT_TACHE).optional(), // absent : identifiant généré par le poste
    corps: CorpsTache,
  }),
  z.object({ kind: z.literal('tache_supprimer'), id: z.string(), tache: z.string().regex(IDENTIFIANT_TACHE) }),
  z.object({ kind: z.literal('tache_executer'), id: z.string(), tache: z.string().regex(IDENTIFIANT_TACHE) }),
];

export const GENRES_RESTE_LOT2 = [
  'compactions',
  'pr_etat',
  'pr_creer',
  'dictee_etat',
  'dictee_service_etat',
  'dictee_service',
  'dictee_transcrire',
  'taches_lister',
  'tache_enregistrer',
  'tache_supprimer',
  'tache_executer',
] as const;
