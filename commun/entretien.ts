// Responsabilité : le vocabulaire de l'entretien partagé par le poste et le relais — ce qu'un poste annonce de lui-même
// (Claude Code, réseau, échange), les commandes du relais (chantiers, processus, réveil) et leurs réponses validées.
import { z } from 'zod';

export const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
export const MAC = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i;

export const VersionsClaude = z.object({ cli: z.string().nullable(), sdk: z.string().nullable() });
export type VersionsClaude = z.infer<typeof VersionsClaude>;

export const ReseauPoste = z.object({ mac: z.string().regex(MAC), diffusion: z.string().regex(IPV4) });
export type ReseauPoste = z.infer<typeof ReseauPoste>;

export const EchangePoste = z.object({ utilise: z.number(), total: z.number() });
export type EchangePoste = z.infer<typeof EchangePoste>;

export const ROLES_PROCESSUS = ['tunnel', 'session', 'outil', 'autre'] as const;
export type RoleProcessus = (typeof ROLES_PROCESSUS)[number];

export const ChantierPoste = z.object({
  fichier: z.string(),
  agent: z.string().nullable(),
  projet: z.string().nullable(),
  statut: z.enum(['en_cours', 'termine', 'echec', 'inconnu']),
  statutBrut: z.string().nullable(),
  mission: z.string().nullable(),
  etape: z.string().nullable(),
  fait: z.array(z.string()),
  majLe: z.string(),
});
export type ChantierPoste = z.infer<typeof ChantierPoste>;

export const ProcessusPoste = z.object({
  pid: z.number(),
  debut: z.string(),
  ppid: z.number(),
  commande: z.string(),
  role: z.enum(ROLES_PROCESSUS),
  session: z.string().nullable(),
  depuis: z.string(),
  memoire: z.number(),
  reste: z.boolean(),
});
export type ProcessusPoste = z.infer<typeof ProcessusPoste>;

export const TmuxPoste = z.object({
  nom: z.string(),
  session: z.string().nullable(),
  depuis: z.string().nullable(),
  reste: z.boolean(),
});
export type TmuxPoste = z.infer<typeof TmuxPoste>;

const NOM_TMUX = /^claude-[\w-]{1,120}$/;

/** Les commandes de l'entretien du relais vers un poste (ajoutées à `CommandeRelais`). */
export const commandesEntretien = [
  z.object({ kind: z.literal('chantiers'), id: z.string() }),
  z.object({ kind: z.literal('processus'), id: z.string() }),
  z.object({
    kind: z.literal('processus_arreter'),
    id: z.string(),
    pid: z.number().int().min(2),
    debut: z.string().regex(/^\d{1,20}$/),
    force: z.boolean(),
  }),
  z.object({ kind: z.literal('tmux_arreter'), id: z.string(), nom: z.string().regex(NOM_TMUX) }),
  z.object({
    kind: z.literal('reveiller'),
    id: z.string(),
    mac: z.string().regex(MAC),
    diffusion: z.string().regex(IPV4),
  }),
];

/** Le résultat d'un geste (arrêt, réveil) : ce qui s'est passé, en une phrase courte, jamais d'hôte ni de port. */
export const ResultatGeste = z.object({ ok: z.boolean(), phrase: z.string() });
export type ResultatGeste = z.infer<typeof ResultatGeste>;

/** Les genres de commande de l'entretien, pour le poste (garde de type). */
export const GENRES_ENTRETIEN = ['chantiers', 'processus', 'processus_arreter', 'tmux_arreter', 'reveiller'] as const;
