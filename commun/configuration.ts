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
  z.object({ kind: z.literal('plugins_lister'), ...avecId }),
  z.object({ kind: z.literal('plugin_activer'), ...avecId, plugin: IdPlugin, actif: z.boolean() }),
];
