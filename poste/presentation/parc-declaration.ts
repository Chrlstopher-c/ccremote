// Responsabilité : les descriptions des sept outils du parc ouverts aux sessions hors de Lanterne. Une seule source
// pour le serveur MCP `parc` ; elles disent quand utiliser chaque outil, et quand ne pas l'utiliser.
import type { OperationParc } from '../../commun/parc.ts';

export const DESCRIPTIONS_PARC: { readonly [operation in OperationParc]: string } = {
  parc_machines:
    'Lister les machines du parc de l’utilisateur : en ligne ou hors ligne, et si un réveil à ' +
    'distance est possible. À utiliser avant de cibler une machine. Ne modifie rien.',
  parc_reveiller:
    'Réveiller à distance (Wake-on-LAN) une machine hors ligne du parc, en général la tour. Elle met quelques ' +
    'dizaines de secondes à répondre : vérifier avec parc_machines ensuite. À n’utiliser que si l’utilisateur le demande ' +
    'ou si une tâche en dépend, et le dire à l’utilisateur. Refuse une machine sans réveil configuré.',
  parc_sessions:
    'Lister les sessions Claude Code du parc : identifiant, machine, titre, statut, dernière activité, dialogue ' +
    'en attente. Par défaut, seulement les sessions vivantes ; `toutes` inclut les fermées. Point de départ pour ' +
    'parc_fil, parc_envoyer et parc_repondre. Ne modifie rien.',
  parc_fil:
    'Lire les derniers échanges lisibles d’une session du parc (messages de l’utilisateur, réponses de Claude, questions, ' +
    'erreurs), 40 lignes au plus. À lire avant d’agir sur une session, pour savoir où elle en est. Ne modifie rien.',
  parc_envoyer:
    'Envoyer un message à une session du parc, comme s’il était tapé dans son terminal. Refusé vers la session ' +
    'dans laquelle tu travailles. Ne pas s’en servir pour répondre à une question destinée à l’utilisateur, ni pour ' +
    'relancer une session sans raison. Une session ouverte dans Claude Desktop sans Remote Control refuse l’envoi : ' +
    'le dire à l’utilisateur.',
  parc_ouvrir:
    'Ouvrir une nouvelle session Claude Code sur une machine du parc, dans un dossier absolu (par exemple ' +
    '/mnt/projects/mon-projet), avec un premier message complet. Elle tourne sur cette machine, indépendamment de ' +
    'la session appelante, et apparaît dans Lanterne. À n’utiliser que si l’utilisateur demande de lancer un travail ' +
    'ailleurs ; ne pas s’en servir pour dupliquer ton propre travail.',
  parc_repondre:
    'Répondre au dialogue bloquant d’une session du parc (question à choix, demande de permission, validation de ' +
    'plan) : `index` de l’option, ou `texte` libre. L’identifiant du dialogue vient de parc_sessions ou parc_fil. ' +
    'À n’utiliser que si l’utilisateur te le demande, et jamais dans ta propre session.',
};
