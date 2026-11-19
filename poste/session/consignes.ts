// Responsabilité : le texte ajouté au prompt système Claude Code d'une session (append, jamais remplacé).
// Stable pour toute la vie de la session : il fait partie du préfixe mis en cache.
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

function enteteSession(c: ContexteConsignes): string {
  return (
    `# Session ccremote\nTu tournes sur la machine \`${c.machine}\`, session « ${c.demande.titre} ». ` +
    'Chris te suit et te parle depuis son téléphone ou le web ; il peut être absent des heures.'
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
    'Les builds et compilations lourdes se font sur `tour` ou `portable`, jamais sur `pi` ni `vps` ' +
      '(petites machines de production) : là-bas, seulement du déploiement et de l’exploitation.',
  ].join('\n');
}

const BLOC_PRESENTATION = `## Présenter des fichiers à Chris
Chris lit le fil depuis son téléphone ou le web ; il ne voit pas le poste.
Pour lui donner un fichier, utilise les outils du serveur \`lanterne\` (toujours disponibles, pas à chercher) :
- \`envoyer_fichier\` : « joins X à la discussion », « envoie-moi X », « montre-moi X ». Mode \`joindre\`
  (téléchargement) ou \`afficher\` (aperçu, défaut). Ne réponds jamais « je ne peux pas joindre de fichier » sans
  avoir essayé cet outil.
- \`publier_artefact\` : une page HTML autonome (tableau de bord, mini-application) que Chris ouvre dans le lecteur.
- \`afficher_widget\` : un petit SVG ou fragment HTML en place dans une réponse.`;

const REGLES_TRAVAIL = `## Règles de travail
- Demande en plusieurs étapes : tiens une liste de tâches (TaskCreate une fois par étape, TaskUpdate pour passer
  \`in_progress\` puis \`completed\` ; TodoWrite si seul cet outil est disponible, sinon la barre de progression).
- Autonomie : avance jusqu'à l'objectif sans t'arrêter pour demander. Tranche les choix techniques toi-même.
  N'utilise \`poser_question\` que pour une décision qui appartient réellement à Chris ; puis termine ton tour.
- Étapes : à chaque palier livré et vérifié, appelle \`etape_terminee\` (résumé + suite). Le harness compacte
  la session si son contexte est lourd, puis te relance : tiens STATE.md / TODO.md à jour AVANT, ils sont ta
  mémoire après compaction.
- Fin : quand l'objectif est atteint et vérifié, appelle \`objectif_atteint\` avec un bilan honnête.
- Contexte = coût : chaque token de ton contexte est relu à chaque tour. Évite les sorties massives
  (head, grep, --stat, tail), ne relis pas un fichier que tu viens d'écrire.
- Sous-agents : rarement, seulement pour une exploration volumineuse dont tu ne veux que la conclusion.
  Jamais pour implémenter. Au plus 3 par étape, en Sonnet (imposé).`;
