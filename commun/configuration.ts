// Responsabilité : le contrat de la configuration Claude d'une machine (styles de sortie, instructions utilisateur,
// compétences, connecteurs, plugins) — les commandes que le relais envoie au poste et ce que le poste rend.
import { z } from 'zod';

// Identifiant `nom@marché` : jamais un argument d'option pour la CLI.
export const IdPlugin = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9@._-]{0,199}$/);

export const NomStyle = z.string().trim().min(1).max(80);

export const StylesSession = z.object({
  actuel: z.string(),
  disponibles: z.array(z.string()),
});
export type StylesSession = z.infer<typeof StylesSession>;

export const InstructionsMachine = z.object({
  chemin: z.string(),
  contenu: z.string(),
  empreinte: z.string(),
});
export type InstructionsMachine = z.infer<typeof InstructionsMachine>;

export const CompetenceMachine = z.object({
  nom: z.string(),
  description: z.string(),
  source: z.enum(['utilisateur', 'plugin']),
  plugin: z.string().optional(),
  chemin: z.string(),
});
export type CompetenceMachine = z.infer<typeof CompetenceMachine>;

export const EtatConnecteur = z.enum(['connecte', 'echec', 'authentification', 'inconnu']);
export type EtatConnecteur = z.infer<typeof EtatConnecteur>;

export const ConnecteurMachine = z.object({
  nom: z.string(),
  cible: z.string(),
  etat: EtatConnecteur,
});
export type ConnecteurMachine = z.infer<typeof ConnecteurMachine>;

// Connecteur défini par l'utilisateur (`~/.claude.json`, portée user) : serveur local (stdio) ou distant (http, sse).
// Une valeur masquée (`MASQUE_VALEUR`) lue, puis renvoyée telle quelle à la modification, garde l'ancienne valeur.
export const MASQUE_VALEUR = '••••••';
export const NomConnecteur = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/);
const CleVariable = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/);
const CleEntete = z.string().regex(/^[A-Za-z0-9-]{1,100}$/);
const ValeurConnecteur = z
  .string()
  .max(4000)
  .regex(/^[^\r\n]*$/);
const URL_DISTANTE = (url: string | undefined): boolean => {
  try {
    return url !== undefined && ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

export const DefinitionConnecteur = z
  .object({
    nom: NomConnecteur,
    type: z.enum(['stdio', 'http', 'sse']),
    commande: z.string().trim().min(1).max(1000).optional(),
    arguments: z.array(z.string().max(2000)).max(100).default([]),
    variables: z.record(CleVariable, ValeurConnecteur).default({}),
    url: z.string().max(2000).optional(),
    entetes: z.record(CleEntete, ValeurConnecteur).default({}),
  })
  .superRefine((d, ctx) => {
    if (d.type === 'stdio' && d.commande === undefined) ctx.addIssue({ code: 'custom', message: 'commande attendue' });
    if (d.type === 'stdio' && d.url !== undefined)
      ctx.addIssue({ code: 'custom', message: 'url réservée aux distants' });
    if (d.type !== 'stdio' && !URL_DISTANTE(d.url)) ctx.addIssue({ code: 'custom', message: 'url http(s) attendue' });
    if (d.type !== 'stdio' && d.commande !== undefined)
      ctx.addIssue({ code: 'custom', message: 'commande réservée aux locaux' });
    if (d.type === 'stdio' && Object.keys(d.entetes).length > 0)
      ctx.addIssue({ code: 'custom', message: 'en-têtes réservés aux distants' });
    if (d.type !== 'stdio' && Object.keys(d.variables).length > 0)
      ctx.addIssue({ code: 'custom', message: 'variables réservées aux locaux' });
  });
export type DefinitionConnecteur = z.infer<typeof DefinitionConnecteur>;

export const PluginMachine = z.object({
  id: z.string(),
  version: z.string(),
  portee: z.string(),
  actif: z.boolean(),
  description: z.string(),
});
export type PluginMachine = z.infer<typeof PluginMachine>;

// `id` : identifiant de la requête (comme les autres commandes du poste), rendu dans la réponse.
const avecId = { id: z.string() };

export const commandesConfiguration = [
  z.object({
    kind: z.literal('styles_creer'),
    ...avecId,
    nom: NomStyle,
    description: z.string().max(300),
    instructions: z.string().min(1).max(20000),
  }),
  z.object({ kind: z.literal('instructions_lire'), ...avecId }),
  z.object({
    kind: z.literal('instructions_ecrire'),
    ...avecId,
    contenu: z.string().max(200000),
    empreinte_avant: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.object({ kind: z.literal('competences_lister'), ...avecId }),
  z.object({ kind: z.literal('competences_contenu'), ...avecId, chemin: z.string().min(1).max(1000) }),
  z.object({ kind: z.literal('connecteurs_machine'), ...avecId }),
  z.object({ kind: z.literal('connecteur_lire'), ...avecId, nom: NomConnecteur, reveler: z.boolean() }),
  z.object({ kind: z.literal('connecteur_ajouter'), ...avecId, definition: DefinitionConnecteur }),
  z.object({ kind: z.literal('connecteur_modifier'), ...avecId, nom: NomConnecteur, definition: DefinitionConnecteur }),
  z.object({ kind: z.literal('connecteur_retirer'), ...avecId, nom: NomConnecteur }),
  z.object({ kind: z.literal('plugins_lister'), ...avecId }),
  z.object({ kind: z.literal('plugin_activer'), ...avecId, plugin: IdPlugin, actif: z.boolean() }),
];
