// Responsabilité : le texte ajouté au prompt système Claude Code d'une session (append, jamais remplacé).
// Stable pour toute la vie de la session : il fait partie du préfixe mis en cache. Neutre : il part sur toute
// installation de Noctis ; ce qui est propre à une personne vit dans sa propre configuration Claude (CLAUDE.md).
import type { DemandeSession } from '../../commun/session.ts';

export interface ContexteConsignes {
  readonly machine: string;
  readonly cwd: string;
  readonly demande: DemandeSession;
  readonly presentation?: boolean; // serveur `lanterne` présent (moteur SDK) : ses outils de présentation sont décrits
}

export function composerConsignes(c: ContexteConsignes): string {
  return [
    enteteSession(c),
    blocProjet(c),
    blocParc(c),
    c.presentation ? BLOC_PRESENTATION : '',
    REGLES_TRAVAIL,
    c.demande.objectif ? `## Objectif de la session\n${c.demande.objectif}` : '',
  ]
    .filter((b) => b.length > 0)
    .join('\n\n');
}

/** Consignes d'une session passée au TUI : son bloc de présentation (outils du serveur `lanterne`, SDK seul) part. */
export function consignesSansPresentation(consignes: string): string {
  return consignes.replace(BLOC_PRESENTATION, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Consignes d'une session repassée au SDK : le bloc de présentation revient en fin de texte, s'il manque. */
export function consignesAvecPresentation(consignes: string): string {
  return consignes.includes(BLOC_PRESENTATION) ? consignes : `${consignes}\n\n${BLOC_PRESENTATION}`;
}

function enteteSession(c: ContexteConsignes): string {
  return (
    `# Session Noctis\nTu tournes sur la machine \`${c.machine}\`, session « ${c.demande.titre} ». ` +
    "L'utilisateur te suit dans Noctis, depuis cet ordinateur, un autre ou son téléphone ; il peut s'absenter."
  );
}

function blocProjet(c: ContexteConsignes): string {
  const { projet } = c.demande;
  if (projet.machine === c.machine)
    return `## Projet\n\`${projet.nom}\`, dans \`${projet.chemin}\` (ton répertoire courant).`;
  return (
    `## Projet\n\`${projet.nom}\` vit sur \`${projet.machine}\`, dans \`${projet.chemin}\`. ` +
    `Ton répertoire courant (\`${c.cwd}\`) n'est qu'un espace de travail local : ` +
    `lis, modifie et lance les commandes du projet via \`ssh ${projet.machine}\`.`
  );
}

function blocParc(c: ContexteConsignes): string {
  const autres = c.demande.parc.filter((m) => m.id !== c.machine);
  if (autres.length === 0) return '## Parc\nAucune autre machine ne t’est accessible depuis celle-ci.';
  const lignes = autres.map((m) => `- \`ssh ${m.id}\` — ${m.description} (projets : ${m.racines.join(', ') || '—'})`);
  return [
    '## Parc — machines joignables par SSH, sans mot de passe',
    ...lignes,
    'Les compilations lourdes se font sur les machines les plus puissantes ; sur un petit serveur de production, ' +
      'seulement du déploiement et de l’exploitation.',
  ].join('\n');
}

export const BLOC_PRESENTATION = `## Présenter des fichiers à l'utilisateur
L'utilisateur lit le fil dans Noctis ; il ne voit pas les fichiers de la machine.
Pour lui montrer un résultat, utilise les outils du serveur \`lanterne\` (toujours disponibles, pas à chercher) :
- \`envoyer_fichier\` : « joins X à la discussion », « envoie-moi X », « montre-moi X ». Mode \`joindre\`
  (téléchargement) ou \`afficher\` (aperçu, défaut). Ne réponds jamais « je ne peux pas joindre de fichier » sans
  avoir essayé cet outil.
- \`publier_artefact\` : une page HTML autonome (tableau de bord, mini-application) qu'il ouvre dans le lecteur.
- \`afficher_widget\` : un petit SVG ou fragment HTML en place dans une réponse (schéma, graphique, illustration).

## Modules de Noctis
Les outils \`modules_lister\`, \`module_appeler\` et \`module_afficher\` pilotent les modules installés dans Noctis.

## Titre de la conversation
\`renommer_conversation\` renomme cette conversation, seulement quand l'utilisateur le demande explicitement.`;

const REGLES_TRAVAIL = `## Règles de travail
- Demande en plusieurs étapes : tiens une liste de tâches (TaskCreate une fois par étape, TaskUpdate pour passer
  \`in_progress\` puis \`completed\` ; TodoWrite si seul cet outil est disponible).
- Avance jusqu'à l'objectif sans t'arrêter pour des détails techniques ; n'utilise \`poser_question\` que pour une
  décision qui appartient réellement à l'utilisateur, puis termine ton tour.
- Étapes : à chaque palier livré et vérifié, appelle \`etape_terminee\` (résumé + suite). Si la session est
  compactée, ce résumé est ta mémoire : garde aussi l'état du travail dans les fichiers du projet.
- Fin : quand l'objectif est atteint et vérifié, appelle \`objectif_atteint\` avec un bilan honnête.
- Contexte = coût : évite les sorties massives et ne relis pas un fichier que tu viens d'écrire.`;

/** Consignes d'une session ordinaire, suivies du prompt système de la conversation (après les consignes Lanterne). */
export function avecPromptSysteme(consignes: string, prompt: string | null): string {
  return [consignes, (prompt ?? '').trim()].filter((bloc) => bloc.length > 0).join('\n\n');
}
