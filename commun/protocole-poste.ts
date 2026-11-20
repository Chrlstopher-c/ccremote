// Responsabilité : les messages échangés entre un poste (machine de travail) et le relais du Pi.
// Sens unique du pouvoir : le relais commande, le poste rend compte. Un poste ne commande jamais rien.
import { z } from 'zod';
import { commandesAppareil, messagesAppareil } from './appareil.ts';
import { commandesConfiguration } from './configuration.ts';
import { Decouverte } from './decouverte.ts';
import { EtatCompte, NOM_COMPTE } from './comptes.ts';
import { CheminSession, TAILLE_MAX_TEXTE_SESSION } from './fichiers-session.ts';
import { CheminModifie, PorteeModifications, TourRef } from './modifications.ts';
import { NOMBRE_MAX_PIECES, PieceJointe } from './presentation.ts';
import {
  DemandeSession,
  EffortSession,
  Evenement,
  ModeSession,
  Projet,
  ReponseDialogue,
  ResumeSession,
} from './session.ts';

// Historique d'une session découverte ou adoptée : le transcript entier, envoyé en lots de cette taille.
export const TAILLE_LOT_HISTORIQUE = 200;

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
    decouvertes: z.array(Decouverte).optional(), // transcripts du poste non encore ouverts dans Lanterne
    empreinte: z.string().optional(), // empreinte du code installé (install par SSH) ; absente pour un poste d'avant
  }),
  z.object({ kind: z.literal('decouvertes'), decouvertes: z.array(Decouverte) }),
  z.object({ kind: z.literal('etat_machine'), etat: EtatMachine }),
  z.object({ kind: z.literal('comptes'), comptes: z.array(EtatCompte) }),
  z.object({ kind: z.literal('session'), session: ResumeSession }),
  z.object({ kind: z.literal('evenement'), sessionId: z.string(), ts: z.string(), evt: Evenement }),
  // Un lot de l'historique (replay : identifiant de la relecture ; le relais ne reçoit une relecture que sur un fil vide).
  z.object({
    kind: z.literal('historique'),
    sessionId: z.string(),
    replay: z.string().min(1).max(64),
    evenements: z.array(z.object({ ts: z.string(), evt: Evenement })).max(TAILLE_LOT_HISTORIQUE),
  }),
  // Delta de texte ou de réflexion : relayé en direct, jamais persisté dans le fil.
  z.object({
    kind: z.literal('flux'),
    sessionId: z.string(),
    bloc: z.string(),
    delta: z.string(),
    genre: z.enum(['texte', 'reflexion']).optional(),
    agent: z.string().optional(), // id de l'appel d'outil du sous-agent auteur (absent = fil principal)
  }),
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
  z.object({
    kind: z.literal('envoyer'),
    ...avecSession,
    texte: z.string().min(1),
    pieces: z.array(PieceJointe).max(NOMBRE_MAX_PIECES).optional(), // images, PDF, fichiers joints par Chris
  }),
  // Lecture d'un fichier présenté (sortie d'outil, image du fil) stocké par la session sur le poste.
  z.object({ kind: z.literal('fichier_session'), ...avecSession, fichier: z.string() }),
  z.object({ kind: z.literal('interrompre'), ...avecSession }),
  // Rembobiner à un message de Chris (la suite est retirée de la reprise) ; dupliquer : nouvelle session jusqu'à ce message.
  z.object({ kind: z.literal('rembobiner'), ...avecSession, messageId: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('dupliquer'), ...avecSession, messageId: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('compacter'), ...avecSession }),
  z.object({ kind: z.literal('fermer'), ...avecSession }),
  z.object({ kind: z.literal('reprendre'), ...avecSession }),
  // Adoption d'une session découverte ou fermée du poste : sa fiche (fermée, reprenable par le SDK) est créée,
  // puis renvoyée.
  z.object({ kind: z.literal('adopter'), ...avecSession }),
  z.object({ kind: z.literal('historique'), ...avecSession }), // relit le transcript : fil vide au relais
  z.object({ kind: z.literal('autonomie'), ...avecSession, active: z.boolean() }),
  z.object({ kind: z.literal('nuit'), ...avecSession, active: z.boolean(), objectif: z.string().max(300).optional() }),
  z.object({ kind: z.literal('remote_control'), ...avecSession, actif: z.boolean() }),
  // Style de sortie (SDK) : appliqué à la requête vivante, gardé pour la reprise ; `styles` liste les disponibles.
  z.object({ kind: z.literal('style'), ...avecSession, style: z.string().min(1).max(80).nullable() }),
  z.object({ kind: z.literal('styles'), ...avecSession }),
  // Connecteur MCP d'une session SDK vivante (activé ou désactivé pour la suite de la session).
  z.object({ kind: z.literal('connecteur'), ...avecSession, nom: z.string().min(1).max(200), actif: z.boolean() }),
  // Conversation annexe : copie complète de la session, en lecture seule, marquée comme annexe de celle-ci.
  z.object({ kind: z.literal('annexer'), ...avecSession }),
  z.object({ kind: z.literal('repondre'), ...avecSession, reponse: ReponseDialogue }),
  // Réglages d'une session SDK en cours : mode de permission, modèle, effort (null = défaut), titre.
  z.object({ kind: z.literal('mode'), ...avecSession, mode: ModeSession }),
  z.object({ kind: z.literal('modele'), ...avecSession, modele: z.string().min(1).max(120) }),
  z.object({ kind: z.literal('effort'), ...avecSession, effort: EffortSession.nullable() }),
  z.object({ kind: z.literal('renommer'), ...avecSession, titre: z.string().min(1).max(120) }),
  // Lectures du panneau de session (SDK) : rien ne change dans la session.
  z.object({ kind: z.literal('contexte'), ...avecSession }),
  z.object({ kind: z.literal('connecteurs'), ...avecSession }),
  z.object({ kind: z.literal('taches'), ...avecSession }),
  z.object({ kind: z.literal('tache'), ...avecSession, tache: z.string().min(1).max(200) }),
  // Arrêt d'une tâche de fond du SDK (commande ou sous-agent) ; `stopTask` du SDK.
  z.object({ kind: z.literal('arreter_tache'), ...avecSession, tache: z.string().min(1).max(200) }),
  // Artefacts d'une session (registre du dossier de la session) : liste, puis gestes sur un artefact.
  z.object({ kind: z.literal('artefacts'), ...avecSession }),
  z.object({
    kind: z.literal('artefact_renommer'),
    ...avecSession,
    artefact: z.string(),
    titre: z.string().min(1).max(120),
  }),
  z.object({ kind: z.literal('artefact_dupliquer'), ...avecSession, artefact: z.string() }),
  z.object({ kind: z.literal('artefact_supprimer'), ...avecSession, artefact: z.string() }),
  z.object({ kind: z.literal('artefact_epingler'), ...avecSession, artefact: z.string(), epingle: z.boolean() }),
  // Modifications d'une session : git du dossier (non commitées ou branche), annulation d'un fichier, commit ;
  // puis les fichiers touchés par un tour (relevés par le poste), leur diff et leur annulation.
  z.object({ kind: z.literal('git_modifications'), ...avecSession, portee: PorteeModifications }),
  z.object({ kind: z.literal('git_diff'), ...avecSession, portee: PorteeModifications, chemin: CheminModifie }),
  z.object({ kind: z.literal('git_annuler'), ...avecSession, chemin: CheminModifie }),
  z.object({ kind: z.literal('git_commiter'), ...avecSession, message: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal('tour_modifications'), ...avecSession, tour: TourRef }),
  z.object({ kind: z.literal('tour_diff'), ...avecSession, tour: TourRef, chemin: CheminModifie }),
  z.object({ kind: z.literal('tour_annuler'), ...avecSession, tour: TourRef }),
  // Panneau Fichiers d'une session (arbre, lecture, écriture) : chemins relatifs au dossier de la session.
  z.object({ kind: z.literal('session_arbre'), ...avecSession, chemin: CheminSession }),
  z.object({ kind: z.literal('session_lire'), ...avecSession, chemin: CheminSession }),
  // Menus « / » et « @ » d'une session : compétences et fichiers du projet, lus sur le poste de la session.
  z.object({ kind: z.literal('session_competences'), ...avecSession }),
  z.object({ kind: z.literal('session_fichiers'), ...avecSession }),
  z.object({
    kind: z.literal('session_ecrire'),
    ...avecSession,
    chemin: CheminSession,
    texte: z.string().max(TAILLE_MAX_TEXTE_SESSION * 4),
  }),
  // Suppression d'une session sur demande explicite de Chris : transcript et sous-agents retirés du poste.
  z.object({ kind: z.literal('supprimer'), ...avecSession }),
  // Sessions Claude Code du poste non encore connues (liste), puis import des identifiants choisis.
  z.object({ kind: z.literal('importables'), id: z.string() }),
  z.object({
    kind: z.literal('importer'),
    id: z.string(),
    ids: z
      .array(z.string().regex(/^[A-Za-z0-9-]{1,100}$/))
      .min(1)
      .max(100),
  }),
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
  // Vue complète d'un compte (profil, usage, crédits, réinitialisations, usage SDK) . Réinitialiser une limite :
  z.object({ kind: z.literal('compte_detail'), id: z.string(), nom: z.string().regex(NOM_COMPTE) }),
  z.object({
    kind: z.literal('compte_reinitialiser'),
    id: z.string(),
    nom: z.string().regex(NOM_COMPTE),
    offre: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  }),
  ...commandesAppareil,
  ...commandesConfiguration,
]);
export type CommandeRelais = z.infer<typeof CommandeRelais>;

export const CHEMIN_POSTE = '/poste';
export const ENTETE_MACHINE = 'x-ccremote-machine';
