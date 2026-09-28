// Responsabilité : les messages échangés entre un poste (machine de travail) et le relais du Pi.
// Sens unique du pouvoir : le relais commande, le poste rend compte. Un poste ne commande jamais rien.
import { z } from 'zod';
import { commandesAppareil, messagesAppareil } from './appareil.ts';
import { EtatCompte, NOM_COMPTE } from './comptes.ts';
import { DemandeSession, Evenement, Projet, ReponseDialogue, ResumeSession } from './session.ts';

export const EtatMachine = z.object({
  cpu: z.number(),
  memoire: z.object({ utilisee: z.number(), totale: z.number() }),
  disque: z.object({ utilise: z.number(), total: z.number() }),
  charge: z.number(),
  demarreeDepuis: z.number(),
  utilisateur: z.string().optional(), // le compte Unix du poste, à viser en SSH (sur le Pi : pi, pas trinity)
});
export type EtatMachine = z.infer<typeof EtatMachine>;

export const MessagePoste = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('bonjour'),
    version: z.string(),
    description: z.string(),
    racines: z.array(z.string()),
    projets: z.array(Projet),
    comptes: z.array(z.string()),
    etatComptes: z.array(EtatCompte).optional(),
    sessions: z.array(ResumeSession),
  }),
  z.object({ kind: z.literal('etat_machine'), etat: EtatMachine }),
  z.object({ kind: z.literal('comptes'), comptes: z.array(EtatCompte) }),
  z.object({ kind: z.literal('session'), session: ResumeSession }),
  z.object({ kind: z.literal('evenement'), sessionId: z.string(), ts: z.string(), evt: Evenement }),
  z.object({ kind: z.literal('flux'), sessionId: z.string(), texte: z.string() }),
  z.object({
    kind: z.literal('reponse'),
    id: z.string(),
    ok: z.boolean(),
    erreur: z.string().optional(),
    donnees: z.unknown().optional(),
  }),
  ...messagesAppareil,
]);
export type MessagePoste = z.infer<typeof MessagePoste>;

const avecSession = { id: z.string(), sessionId: z.string() };

export const CommandeRelais = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ouvrir'), id: z.string(), demande: DemandeSession }),
  z.object({ kind: z.literal('envoyer'), ...avecSession, texte: z.string().min(1) }),
  z.object({ kind: z.literal('interrompre'), ...avecSession }),
  z.object({ kind: z.literal('compacter'), ...avecSession }),
  z.object({ kind: z.literal('fermer'), ...avecSession }),
  z.object({ kind: z.literal('reprendre'), ...avecSession }),
  z.object({ kind: z.literal('autonomie'), ...avecSession, active: z.boolean() }),
  z.object({ kind: z.literal('repondre'), ...avecSession, reponse: ReponseDialogue }),
  z.object({ kind: z.literal('projets'), id: z.string() }),
  z.object({ kind: z.literal('eteindre'), id: z.string() }),
  // Comptes Claude Code : connexion OAuth en deux temps (URL, puis code collé par Chris), retrait, relevé immédiat.
  z.object({
    kind: z.literal('compte_connecter'),
    id: z.string(),
    nom: z.string().regex(NOM_COMPTE),
    email: z.string().email().optional(), // pré-remplit la page de connexion : ajouter un compte déjà connu ailleurs
  }),
  z.object({ kind: z.literal('compte_code'), id: z.string(), nom: z.string(), code: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal('compte_retirer'), id: z.string(), nom: z.string() }),
  z.object({ kind: z.literal('comptes_relever'), id: z.string() }),
  ...commandesAppareil,
]);
export type CommandeRelais = z.infer<typeof CommandeRelais>;

export const CHEMIN_POSTE = '/poste';
export const ENTETE_MACHINE = 'x-ccremote-machine';
