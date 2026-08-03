/**
 * Le prompt initial d'un team leader — la seule chose qui lui apprenne comment
 * ce harness fonctionne. Il ne lit pas ce dépôt.
 *
 * `☠` Cette surface n'avait AUCUN test avant le 01/08, et c'est ce qui a permis
 * au défaut central d'y vivre : `rapport_equipe` rend le DERNIER BLOC TEXTE du
 * lead, tel quel, et depuis que la fin d'une équipe notifie l'orchestrateur, ce
 * bloc est lu automatiquement pour décider de la suite. Personne ne l'avait
 * jamais dit au lead. Un « c'est fait ✅ » final et la décision suivante se
 * prend sur du vide.
 *
 * Ces tests ne vérifient pas une formulation — ils vérifient que chaque
 * information dont le lead a BESOIN pour ne pas se tromper est présente.
 */

import { describe, expect, test } from 'bun:test';
import { composerMandatSysteme, composerPromptInitial } from './dispatch-mandat.ts';
import type { Proposition } from '../registre/index.ts';
import { PLAFOND_EQUIPE_USD } from '../../shared/budget-equipe.ts';

const MANDAT: Proposition = {
  id: 'p1',
  conversationId: 'conv-a',
  projet: 'vela',
  objectif: 'corriger le démarrage du daemon',
  critereArret: 'le daemon démarre et le test d’intégration passe',
  perimetre: 'src-tauri/ uniquement',
  acces: 'ecriture',
  budgetMaxUsd: 8,
  modele: null,
  effort: null,
  statut: 'en_attente',
  missionId: null,
  detail: null,
  creeA: 0,
  majA: 0,
};

describe('ce que le lead doit savoir de son rapport', () => {
  // `☠` Lu sur le MANDAT SYSTÈME, jamais sur le premier message : les workers
  // tournent en `autoCompactEnabled: true`. Le premier message disparaît à la
  // compaction, le systemPrompt survit. Une règle qui doit tenir au tour 50 et
  // qui ne vit que dans le premier message est une règle qui s'évapore
  // exactement quand le mandat devient long.
  const prompt = composerMandatSysteme(MANDAT, 'ecriture');

  test('il est prévenu que son dernier message EST le rapport', () => {
    expect(prompt).toContain('TON DERNIER MESSAGE EST TON RAPPORT');
  });

  test('il sait que personne ne le reformule', () => {
    // Sans ça, il suppose qu'un résumé est construit ailleurs et se contente
    // d'une phrase de conclusion.
    expect(prompt).toContain('ne construit aucune synthèse');
  });

  test('il sait qu’une machine décide dessus, souvent sans relecture humaine', () => {
    expect(prompt).toContain('orchestrateur décide de la suite');
  });

  test('la structure attendue est donnée, pas seulement exigée', () => {
    // Les quatre points : critère d'arrêt, ce qui a changé, ce qui a été
    // vérifié et comment, ce qui reste ouvert.
    expect(prompt).toContain('critère d’arrêt est-il atteint');
    expect(prompt).toContain('fichier par fichier');
    expect(prompt).toContain('ce que tu as VÉRIFIÉ');
    expect(prompt).toContain('reste ouvert');
  });

  test('« les tests passent » est explicitement insuffisant', () => {
    // `☠` La formule qui a coûté le plus cher à ce dépôt : un vert annoncé sans
    // ce qui a été exécuté ne se distingue pas d'un test qui décore.
    expect(prompt).toContain('pas');
    expect(prompt).toContain('les tests passent');
  });
});

describe('ce que le lead doit savoir de son cadre', () => {
  test('le budget est annoncé, avec sa conséquence', () => {
    const prompt = composerMandatSysteme(MANDAT, 'ecriture');
    // Il coupe la session sans préavis : un mandat tranché en deux ressemble à
    // un crash, et la relance repart se faire couper au même endroit.
    expect(prompt).toContain('8.00 $');
    expect(prompt).toContain('coupée net');
  });

  test('un budget absent retombe sur le défaut, jamais sur « 0 $ »', () => {
    const prompt = composerMandatSysteme({ ...MANDAT, budgetMaxUsd: 0 }, 'ecriture');
    // ☠ Ancré sur « Budget : », pas sur « 0.00 $ » seul — la sous-chaîne se
    // retrouve dans n'importe quel montant rond (« 250.00 $ » la contient), et
    // l'assertion échouait donc sur un prompt parfaitement correct.
    expect(prompt).not.toContain('Budget : 0.00 $');
    // Le montant annoncé au lead est le plafond RÉELLEMENT transmis au SDK :
    // les deux sortent de `plafondEffectifUsd`, ils ne peuvent plus diverger.
    expect(prompt).toContain(`Budget : ${PLAFOND_EQUIPE_USD.toFixed(2)} $`);
  });

  test('un message en cours de route n’est pas un ordre d’arrêt', () => {
    // Sans cette phrase, le lead répond par une synthèse de fin à une simple
    // correction de cap, et s'arrête alors que rien ne le lui demandait.
    const prompt = composerMandatSysteme(MANDAT, 'ecriture');
    expect(prompt).toContain('jamais un ordre');
    expect(prompt).toContain('poursuis');
  });

  test('il sait qu’il est observé en direct', () => {
    expect(composerMandatSysteme(MANDAT, 'ecriture')).toContain('en direct');
  });
});

describe('l’accès annoncé correspond à l’accès appliqué', () => {
  test('lecture : les outils refusés sont NOMMÉS, et Bash annoncé disponible', () => {
    const prompt = composerPromptInitial(MANDAT, 'lecture');
    // `☠` Sans les noms, le lead brûle son budget à retenter Write en boucle.
    expect(prompt).toContain('LECTURE SEULE');
    expect(prompt).toContain('Write, Edit et NotebookEdit');
    expect(prompt).toContain('Bash reste disponible');
  });

  test('lecture : on lui dit aussi de ne pas contourner par le shell', () => {
    // Bash est ouvert par choix (exploration) — l'accès reste une consigne sur
    // l'écriture de fichiers, et elle doit être écrite.
    expect(composerPromptInitial(MANDAT, 'lecture')).toContain('n’écris pas de fichier par ce biais');
  });

  test('écriture : aucune mention de refus qui l’induirait en erreur', () => {
    const prompt = composerPromptInitial(MANDAT, 'ecriture');
    expect(prompt).toContain('lecture et écriture');
    expect(prompt).not.toContain('LECTURE SEULE');
  });
});

describe('l’autonomie, dite sans ambiguïté', () => {
  const prompt = composerMandatSysteme(MANDAT, 'ecriture');

  test('il sait que poser une question ici n’atteint personne', () => {
    expect(prompt).toContain('aucune question posée ici n’atteindra un humain');
  });

  test('la conduite à tenir sur un choix qui le dépasse est donnée', () => {
    // « Décide seul » sans issue formulée produit un blocage ou un choix
    // irréversible pris à la légère.
    expect(prompt).toContain('la plus réversible');
    expect(prompt).toContain('rapport final');
  });

  test('l’état des lieux avant toute modification reste demandé', () => {
    // Celui-là appartient bien au premier message : c'est une amorce, pas une
    // règle permanente.
    expect(composerPromptInitial(MANDAT, 'ecriture')).toContain("l'état des lieux avant de modifier");
  });
});

/**
 * `☠` LE groupe qui aurait attrapé le défaut du 01/08, et qui n'existait pas :
 * `mandate` ne portait que `p.objectif` — une ligne. Tout le reste vivait dans
 * le premier message, donc s'évaporait à la première compaction du lead.
 */
describe('ce qui doit SURVIVRE à la compaction du lead', () => {
  const systeme = composerMandatSysteme(MANDAT, 'lecture');

  test('le critère d’arrêt', () => {
    expect(systeme).toContain(MANDAT.critereArret ?? '');
  });

  test('le périmètre', () => {
    expect(systeme).toContain('src-tauri/');
  });

  test('l’accès réel', () => {
    expect(systeme).toContain('LECTURE SEULE');
  });

  test('le budget', () => {
    expect(systeme).toContain('8.00 $');
  });

  test('son rôle de team leader et l’exigence de validation réelle (H-52)', () => {
    // Vivait dans CLAUSES_FIXES, qui ne partait qu'à l'AFFICHAGE de la carte
    // d'autorisation — jamais au worker.
    expect(systeme).toContain('team leader');
    expect(systeme).toContain('lire du code ne suffit pas');
  });

  test('l’attribution orchestrateur / opérateur (H-66)', () => {
    // Même origine, même défaut : le lead ne pouvait pas distinguer qui lui
    // parlait, et faisait porter à l'un les décisions de l'autre.
    expect(systeme).toContain('Ne jamais attribuer à l’opérateur');
  });

  // `☠` 03/08 : mesuré sur deux équipes réelles, l'outil Bash refuse un `sleep`
  // nu et coupe à 120 s. Sans la règle, un agent part en `run_in_background` et
  // rend « Waiting for background process to complete... » au lieu de son
  // travail — trois sous-agents sur cinq au premier test. Elle doit survivre à
  // la compaction : un lead au tour 50 attend autant qu'au tour 1.
  test('comment attendre au shell — la forme du blocage, telle qu’elle a été mesurée', () => {
    // `☠` Quatre mesures, 03/08 : `sleep 1` seul PASSE · `sleep 35` seul BLOQUÉ ·
    // `echo; sleep 35; echo` PASSE · `echo; sleep 170; echo` PASSE. Les deux
    // propriétés comptent ENSEMBLE. La première rédaction disait « un sleep nu
    // est refusé » : un agent l'aurait lue comme une interdiction générale et
    // aurait contourné des formes acceptées.
    expect(systeme).toContain('SEUL ET LONG');
    expect(systeme).toContain('until [ $(date +%s) -ge $fin ]');
    // Le plafond de 120 s n'est PAS systématique — mesuré dans les deux sens le
    // même jour. Le prompt doit dire « parfois », sinon il fait douter un agent
    // de ce qu'il observe.
    expect(systeme).toContain('parfois coupée à 120 s, pas');
  });

  test('☠ arrêter un process lancé en arrière-plan — `$!` ment', () => {
    // Relevé sur un transcript réel : `$!` après `nohup … &` a rendu le wrapper
    // bash, le `kill` n'a rien tué, le serveur répondait toujours. Plus
    // systématique que le cas `sleep`.
    expect(systeme).toContain('`$!` désigne');
    expect(systeme).toContain('pgrep -af');
  });

  test('les trois gestes qui prouvent un correctif', () => {
    expect(systeme).toContain('DEUX SENS');
    expect(systeme).toContain('artefact RÉEL');
    expect(systeme).toContain('est-il jamais écrit');
  });
});

describe('le premier message reste une amorce, jamais le cadre', () => {
  test('il n’est jamais vide — un flux silencieux n’émet pas `init` (H-60)', () => {
    expect(composerPromptInitial(MANDAT, 'ecriture').trim().length).toBeGreaterThan(50);
  });

  test('il renvoie explicitement aux instructions système', () => {
    // Sans ce renvoi, un lead compacté ne sait pas que son cadre est ailleurs.
    expect(composerPromptInitial(MANDAT, 'ecriture')).toContain('instructions système');
  });

  test('il porte l’objectif — de quoi amorcer sans relire', () => {
    expect(composerPromptInitial(MANDAT, 'ecriture')).toContain(MANDAT.objectif);
  });
});
