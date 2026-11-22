// Responsabilité : le vocabulaire de « Ajouter une machine au réseau » (Paramètres › Réseau, outil des sessions) —
// corps de la demande, étapes et vue de l'avancement. Pur : aucune E/S.
import { z } from 'zod';

/** Identifiant de machine : le même que celui du poste qu'elle remplace (badge, catégories, épinglages). */
export const ID_MACHINE_AJOUT = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Nom affiché : pas de guillemet, d'antislash, de dollar ni d'accent grave (il passe dans un script distant). */
export const NOM_AJOUT = /^[\p{L}\p{N} ._()'-]{1,60}$/u;

export const SshAjout = z.strictObject({
  hote: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/, 'hôte invalide'),
  port: z.number().int().min(1).max(65535).default(22),
  utilisateur: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/, 'utilisateur invalide'),
  cle: z.string().regex(/^\/[^\n\0]+$/, 'clé : chemin absolu attendu'),
});
export type SshAjout = z.infer<typeof SshAjout>;

/**
 * `POST /api/reseau/ajouts`. Sans `ssh`, la machine est une machine SSH déjà configurée (Paramètres › Machines) : son
 * identifiant est repris tel quel, et son poste actuel est basculé sur le nœud. `aiguilleur` : adresse de l'aiguilleur
 * vue de la machine (absente : celle de ce nœud).
 */
export const CorpsAjoutNoeud = z.strictObject({
  machine: z.string().regex(ID_MACHINE_AJOUT, 'identifiant : minuscules, chiffres, tirets (40 max)'),
  nom: z.string().trim().regex(NOM_AJOUT, 'nom : lettres, chiffres, espaces, . _ ( ) \' - (60 max)'),
  ssh: SshAjout.optional(),
  aiguilleur: z.string().max(500).optional(),
});
export type CorpsAjoutNoeud = z.infer<typeof CorpsAjoutNoeud>;

/** Étapes, dans l'ordre : l'interface les affiche toutes, faites, en cours ou à venir. */
export const ETAPES_AJOUT = [
  'verification',
  'code',
  'envoi',
  'installation',
  'appairage',
  'accord',
  'lien',
  'reprise',
] as const;
export type EtapeAjout = (typeof ETAPES_AJOUT)[number];

export type EtatAjout = 'en_cours' | 'accord_attendu' | 'fini' | 'echec' | 'retire';

export interface RepriseAjout {
  /** Sessions de la machine connues ici et retrouvées sur son nœud (même identifiant). */
  readonly retrouvees: number;
  /** Sessions connues ici, absentes du nœud (non archivées) : à signaler. */
  readonly absentes: number;
  /** Épinglages reportés sur le nœud. */
  readonly epinglees: number;
  /** Sessions archivées ici : gardées ici, telles quelles. */
  readonly archivees: number;
}

/** Avancement d'un ajout (`GET /api/reseau/ajouts`) ; aucun secret, aucun hôte. */
export interface VueAjout {
  readonly machine: string;
  readonly nom: string;
  readonly etape: EtapeAjout;
  readonly etat: EtatAjout;
  readonly message: string | null;
  /** La machine remplace un poste existant (bascule) : ses sessions gardent leur identifiant. */
  readonly bascule: boolean;
  /** Identifiant de membre du nouveau nœud sur l'aiguilleur. */
  readonly membre: string | null;
  /** Empreinte du nouveau nœud, lue par SSH (canal indépendant de l'aiguilleur). */
  readonly empreinteSsh: string | null;
  /** Empreinte de cette machine telle que le nouveau nœud l'a reçue par l'aiguilleur. */
  readonly empreinteVueParLeNoeud: string | null;
  /** Empreinte du nœud telle que la demande d'appairage l'apporte ici, par l'aiguilleur. */
  readonly empreinteDemande: string | null;
  readonly concordance: 'identique' | 'differente' | null;
  readonly reprise: RepriseAjout | null;
  readonly majLe: string;
}
