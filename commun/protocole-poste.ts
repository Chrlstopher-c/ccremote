// Responsabilité : les messages échangés entre un poste (machine de travail) et le relais du Pi.
// Sens unique du pouvoir : le relais commande, le poste rend compte. Un poste ne commande jamais rien.
import { z } from 'zod';
import { DemandeSession, Evenement, Projet, ResumeSession } from './session.ts';

export const EtatMachine = z.object({
  cpu: z.number(),
  memoire: z.object({ utilisee: z.number(), totale: z.number() }),
  disque: z.object({ utilise: z.number(), total: z.number() }),
  charge: z.number(),
  demarreeDepuis: z.number(),
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
    sessions: z.array(ResumeSession),
  }),
  z.object({ kind: z.literal('etat_machine'), etat: EtatMachine }),
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
  z.object({ kind: z.literal('projets'), id: z.string() }),
  z.object({ kind: z.literal('eteindre'), id: z.string() }),
]);
export type CommandeRelais = z.infer<typeof CommandeRelais>;

export const CHEMIN_POSTE = '/poste';
export const ENTETE_MACHINE = 'x-ccremote-machine';
