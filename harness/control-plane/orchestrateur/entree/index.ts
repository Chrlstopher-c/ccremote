/**
 * Interface publique du slice « entrée » de l'orchestrateur (A.1.3).
 * Tout accès depuis un autre domaine passe par ce fichier.
 */
export { GenerateurEntree } from './generateur-entree.ts'
export type {
  CauseFermetureImprevue,
  ContexteFermetureImprevue,
  EtatGenerateur,
  OptionsGenerateurEntree,
} from './generateur-entree.ts'
export { FileAttente } from './file-attente.ts'
export type { OptionsFileAttente, ResultatRetrait } from './file-attente.ts'
export { construireMessageUtilisateur } from './message-utilisateur.ts'
export type { OptionsMessage } from './message-utilisateur.ts'
export { FileFermeeErreur, FluxDejaConsommeErreur } from './erreurs.ts'
export { creerJournal, journalSilencieux } from './journal.ts'
export type { Journal } from './journal.ts'
