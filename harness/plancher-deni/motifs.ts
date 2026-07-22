/**
 * Responsabilité : la liste-cadre du plancher de déni (C.1.3, H-41, H-50).
 *
 * Cadre imposé par l'opérateur, inchangé depuis H-50 : destruction hors worktree,
 * réécriture d'historique git partagé, écrasement de secrets, désinstallation
 * d'outillage système. Rien qui gêne le travail normal (H-41).
 *
 * `☠ CASSE` évité ici — panne #21 : chaque motif est une règle **scopée**
 * (`Outil(contenu)`), jamais un nom d'outil nu. Une règle scopée refuse dans
 * **tous** les modes de permission, y compris `bypassPermissions` (C.1.2/C.1.3) —
 * c'est ce qui rend ce plancher un vrai plancher, pas une convention.
 *
 * `☠ CASSE` évité ici — panne #22 : `motifs.test.ts` teste chaque motif à la
 * fois côté refus (commande dangereuse représentative) et côté silence
 * (commande représentative du travail quotidien). Un plancher jamais testé
 * ne refuse rien et ne le montre pas.
 */

import type { MotifDeni } from './types.ts';
import { formatterRegleSdk } from './types.ts';

/**
 * Plafond imposé par la mission (« pas plus de ~15 ») : au-delà, l'opérateur contourne
 * le plancher. Porté à 16 pour loger `pkill-motif-generique` — incident réel payé le
 * 2026-07-08 sur le Raspberry Pi partagé : un `pkill -f "uvicorn app.main:app"` destiné
 * au nettoyage d'un déploiement a tué un backend tiers, par SIGTERM propre, donc sans
 * que le `Restart=on-failure` de systemd le relève. Panne muette exemplaire.
 */
export const MAX_MOTIFS_PLANCHER = 16;

export const PLANCHER_DENI: readonly MotifDeni[] = [
  // --- Destruction hors worktree / système ---------------------------------
  {
    id: 'rm-rf-racine',
    outil: 'Bash',
    contenuRegle: 'rm -rf /*',
    porte: 'Suppression récursive forcée partant de la racine du système de fichiers.',
    nonQuotidien:
      'Le travail courant supprime des chemins relatifs au worktree (node_modules, dist…), ' +
      'jamais un chemin absolu partant de /.',
  },
  {
    id: 'rm-rf-home',
    outil: 'Bash',
    contenuRegle: 'rm -rf ~*',
    porte: "Suppression récursive forcée du répertoire personnel de l'opérateur (tilde).",
    nonQuotidien: 'Aucune tâche de dev légitime ne cible ~ entier : le worktree est un sous-répertoire, pas le home.',
  },
  {
    id: 'rm-rf-home-var',
    outil: 'Bash',
    contenuRegle: 'rm -rf $HOME*',
    porte: 'Suppression récursive forcée du home via la variable d’environnement plutôt que le tilde.',
    nonQuotidien: 'Même raisonnement que rm-rf-home ; couvre la forme alternative la plus fréquente.',
  },
  {
    id: 'rm-rf-hors-worktree',
    outil: 'Bash',
    contenuRegle: 'rm -rf ..*',
    porte: 'Suppression récursive forcée remontant hors du worktree par chemin relatif (`..`).',
    nonQuotidien: 'Le travail normal ne remonte jamais au-dessus de son propre worktree pour supprimer quelque chose.',
  },
  {
    id: 'sudo-rm-rf',
    outil: 'Bash',
    contenuRegle: 'sudo rm -rf*',
    porte: 'Toute suppression récursive forcée exécutée avec privilèges élevés, quelle que soit la cible.',
    nonQuotidien: "`sudo` n'apparaît jamais dans un cycle de dev normal sur un worktree applicatif.",
  },
  {
    id: 'dd-vers-peripherique',
    outil: 'Bash',
    contenuRegle: '*dd *of=/dev*',
    porte: 'Écriture brute sur un périphérique bloc via `dd` — efface disques ou partitions.',
    nonQuotidien: "`dd` n'intervient jamais dans un flux de build, test ou déploiement applicatif courant.",
  },
  {
    id: 'mkfs',
    outil: 'Bash',
    contenuRegle: '*mkfs*',
    porte: 'Formatage d’un système de fichiers — efface tout son contenu, irréversible.',
    nonQuotidien: 'Jamais invoqué par un cycle de développement, seulement par une intervention disque volontaire.',
  },
  // --- Réécriture d'historique git partagé ---------------------------------
  {
    id: 'git-push-force-long',
    outil: 'Bash',
    contenuRegle: 'git push*--force*',
    porte: "Réécriture forcée de l'historique git d'un dépôt partagé (forme longue `--force`).",
    nonQuotidien: 'Un push normal ne force jamais ; le force push est une opération rare et délibérée.',
  },
  {
    id: 'git-push-force-court',
    outil: 'Bash',
    contenuRegle: 'git push* -f*',
    porte: "Réécriture forcée de l'historique git d'un dépôt partagé (alias court `-f`, espace exigé avant le flag).",
    nonQuotidien:
      "L'espace exigé avant `-f` évite le faux positif sur un nom de branche du type " +
      "« my-feature » (pas d'espace avant son trait d'union) — vérifié en test.",
  },
  // --- Désinstallation d'outillage système ---------------------------------
  {
    id: 'apt-get-remove',
    outil: 'Bash',
    contenuRegle: '*apt-get *remove*',
    porte:
      "Désinstallation d'outillage système via apt-get (remove). `purge` n'est " +
      'volontairement pas un motif séparé : gardé hors plancher pour rester sous le plafond ' +
      'de 15 motifs (limite documentée, à rouvrir si Chris le juge utile).',
    nonQuotidien: 'Le dev quotidien installe des dépendances, il ne désinstalle jamais un paquet système.',
  },
  {
    id: 'pacman-remove',
    outil: 'Bash',
    contenuRegle: '*pacman -R*',
    porte: "Désinstallation d'outillage système via pacman (Arch), quelles que soient les options (-R/-Rs/-Rns).",
    nonQuotidien: 'Même raisonnement qu’apt-get-remove, pour un poste sous Arch plutôt que Debian.',
  },
  // --- Terminaison de process par motif générique ---------------------------
  {
    id: 'pkill-motif-generique',
    outil: 'Bash',
    contenuRegle: '*pkill -f *',
    porte:
      'Terminaison de process par motif de ligne de commande. Sur un hôte partagé, un motif ' +
      "générique (`uvicorn`, `node`, `python`, `vite`) tue aussi les process d'AUTRES projets.",
    nonQuotidien:
      "Un projet arrête ses propres process via son `stop.sh` et un PID, pas en balayant la table " +
      'des process de la machine.',
  },
  // --- Écrasement de secrets ------------------------------------------------
  {
    id: 'ecrasement-env',
    outil: 'Write',
    contenuRegle: '**/.env',
    porte: 'Écrasement d’un fichier `.env` contenant des secrets, à quelque profondeur que ce soit.',
    nonQuotidien:
      'Le dev quotidien lit un `.env`, il ne le réécrit pas via l’outil Write — la config secrète se modifie à la main.',
  },
  {
    id: 'edition-env',
    outil: 'Edit',
    contenuRegle: '**/.env',
    porte: 'Édition d’un fichier `.env` existant — même risque que Write, autre outil.',
    nonQuotidien: 'Même raisonnement que ecrasement-env, sur l’outil Edit plutôt que Write.',
  },
  {
    id: 'ecrasement-ssh',
    outil: 'Write',
    contenuRegle: '**/.ssh/**',
    porte: 'Écrasement de toute clé ou config SSH sous `~/.ssh`.',
    nonQuotidien: 'Un cycle de dev applicatif ne touche jamais aux clés SSH de l’opérateur.',
  },
  {
    id: 'ecrasement-credentials-cc',
    outil: 'Write',
    contenuRegle: '**/.credentials.json',
    porte: 'Écrasement des identifiants OAuth Claude Code du poste (compte actif ou isolé, H-53).',
    nonQuotidien: 'Ce fichier est géré exclusivement par le CLI Claude Code lui-même, jamais par une tâche de dev.',
  },
];

/** Forme exacte à passer à `WorkerSpec.deniedToolPatterns` / `Options.disallowedTools`. */
export const PLANCHER_DENI_SDK: readonly string[] = PLANCHER_DENI.map(formatterRegleSdk);
