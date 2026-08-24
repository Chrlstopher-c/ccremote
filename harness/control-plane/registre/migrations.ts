/**
 * Responsabilité : versionnage et application du schéma SQLite du registre.
 * Autorité de version : `PRAGMA user_version`. La table `migration_appliquee`
 * n'est qu'une trace d'audit — elle ne décide de rien.
 */

import type { Database } from 'bun:sqlite';
import { executer, journal } from './journal.ts';

export interface Migration {
  readonly version: number;
  readonly nom: string;
  readonly sql: string;
}

/**
 * Migration 1 — schéma initial.
 *
 * Deux invariants portés par le schéma lui-même, pas par le code appelant :
 *  - `etat_sdk` et `etat_harness` sont deux colonnes distinctes, avec deux CHECK
 *    disjoints (panne #30) : écrire `running` dans l'état harness échoue.
 *  - un seul enregistrement actif par projet (H-56), via un index unique partiel.
 *
 * Dimensionnement (panne #5) : le régime est « N missions courtes × rétention ».
 * Les requêtes chaudes (parc actif) passent par des index partiels bornés au
 * nombre de missions ACTIVES, jamais au volume historique. Les tables qui
 * croissent (mission close, transition_etat) sont indexées sur leur date de fin
 * pour permettre une purge par ancienneté en balayage d'index.
 */
const MIGRATION_1 = `
CREATE TABLE lot (
  id         TEXT PRIMARY KEY,
  intention  TEXT NOT NULL,
  origine    TEXT,
  cree_a     INTEGER NOT NULL,
  clos_a     INTEGER
) STRICT;

CREATE INDEX idx_lot_cree_a ON lot(cree_a DESC);
CREATE INDEX idx_lot_ouvert ON lot(cree_a DESC) WHERE clos_a IS NULL;

CREATE TABLE compte (
  id              TEXT PRIMARY KEY,
  config_dir      TEXT NOT NULL UNIQUE,
  email           TEXT,
  organisation    TEXT,
  type_abonnement TEXT,
  fournisseur_api TEXT,
  actif           INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0, 1)),
  cree_a          INTEGER NOT NULL,
  maj_a           INTEGER NOT NULL
) STRICT;

CREATE TABLE quota_compte (
  compte_id       TEXT NOT NULL REFERENCES compte(id) ON DELETE CASCADE,
  type_fenetre    TEXT NOT NULL,
  statut          TEXT NOT NULL CHECK (statut IN ('allowed', 'allowed_warning', 'rejected')),
  reset_a         INTEGER,
  utilisation     REAL,
  statut_overage  TEXT,
  utilise_overage INTEGER CHECK (utilise_overage IN (0, 1)),
  seuil_depasse   TEXT,
  observe_a       INTEGER NOT NULL,
  PRIMARY KEY (compte_id, type_fenetre)
) STRICT;

CREATE TABLE mission (
  id                        TEXT PRIMARY KEY,
  lot_id                    TEXT NOT NULL REFERENCES lot(id) ON DELETE CASCADE,
  nom                       TEXT NOT NULL,
  projet                    TEXT NOT NULL,
  worktree                  TEXT,
  branche                   TEXT,
  session_id                TEXT,
  compte_id                 TEXT NOT NULL REFERENCES compte(id),
  mandat                    TEXT,
  critere_arret             TEXT,
  modele_demande            TEXT,
  modele_resolu             TEXT,

  etat_sdk                  TEXT CHECK (etat_sdk IN ('idle', 'running', 'requires_action')),
  etat_sdk_maj_a            INTEGER,

  etat_harness              TEXT NOT NULL CHECK (etat_harness IN (
                              'planifiee', 'en_cours', 'en_pause', 'attente_machine',
                              'echec_definitif', 'terminee', 'annulee')),
  etat_harness_maj_a        INTEGER NOT NULL,

  epoch                     INTEGER NOT NULL DEFAULT 0,
  high_water_mark           INTEGER NOT NULL DEFAULT 0,

  budget_max_usd            REAL,
  budget_consomme_usd       REAL NOT NULL DEFAULT 0,
  contexte_tokens_utilises  INTEGER,
  contexte_tokens_max       INTEGER,
  compteur_relances         INTEGER NOT NULL DEFAULT 0,
  derniere_raison_terminale TEXT,

  cree_a                    INTEGER NOT NULL,
  demarree_a                INTEGER,
  terminee_a                INTEGER
) STRICT;

CREATE UNIQUE INDEX idx_mission_active_par_projet
  ON mission(projet)
  WHERE etat_harness IN ('planifiee', 'en_cours', 'en_pause', 'attente_machine');

CREATE INDEX idx_mission_actives
  ON mission(etat_harness, etat_harness_maj_a)
  WHERE etat_harness IN ('planifiee', 'en_cours', 'en_pause', 'attente_machine');

CREATE INDEX idx_mission_lot ON mission(lot_id, cree_a);
CREATE INDEX idx_mission_compte ON mission(compte_id, cree_a DESC);
CREATE INDEX idx_mission_session ON mission(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_mission_purge ON mission(terminee_a) WHERE terminee_a IS NOT NULL;
CREATE INDEX idx_mission_cree_a ON mission(cree_a DESC);

CREATE TABLE transition_etat (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id      TEXT NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
  origine         TEXT NOT NULL CHECK (origine IN ('sdk', 'harness')),
  etat_precedent  TEXT,
  etat_nouveau    TEXT NOT NULL,
  motif           TEXT,
  survenu_a       INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_transition_mission ON transition_etat(mission_id, survenu_a);
CREATE INDEX idx_transition_survenu_a ON transition_etat(survenu_a);

CREATE TABLE capacite_mission (
  mission_id TEXT NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
  capacite   TEXT NOT NULL,
  presente   INTEGER NOT NULL CHECK (presente IN (0, 1)),
  observe_a  INTEGER NOT NULL,
  PRIMARY KEY (mission_id, capacite)
) STRICT;

CREATE TABLE migration_appliquee (
  version    INTEGER PRIMARY KEY,
  nom        TEXT NOT NULL,
  applique_a INTEGER NOT NULL
) STRICT;
`;

/**
 * Migration 2 — conversations de l'orchestrateur (multi-session, type ChatGPT).
 *
 * Chaque conversation est une session Agent SDK indépendante (contexte isolé,
 * `session_id` pour la reprise après redémarrage du Pi). Le journal d'événements
 * porte la conversation ET sert de substrat au streaming : l'UI interroge par
 * `seq` croissant (`WHERE conversation_id=? AND seq>?`) et n'a jamais à recevoir
 * deux fois le même bloc. `seq` est un AUTOINCREMENT global — un curseur
 * monotone unique, valable comme point de reprise même après un rechargement dur
 * de la page (la persistance vit ici, pas dans le DOM).
 *
 * `type` distingue ce qu'un bloc SDK contient réellement : `reflexion` (thinking),
 * `texte` (réponse), `outil` (un tool_use, le « commentaire pendant la
 * génération »), `resultat` (fin de tour), `erreur`. Les fusionner ferait perdre
 * la distinction que l'UI doit rendre (bloc de réflexion repliable ≠ réponse).
 */
const MIGRATION_2 = `
CREATE TABLE conversation (
  id         TEXT PRIMARY KEY,
  titre      TEXT NOT NULL,
  session_id TEXT,
  statut     TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('active', 'archivee')),
  cree_a     INTEGER NOT NULL,
  maj_a      INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_conversation_maj ON conversation(statut, maj_a DESC);

CREATE TABLE conversation_evenement (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('operateur', 'reflexion', 'texte', 'outil', 'resultat', 'erreur')),
  contenu         TEXT NOT NULL,
  cree_a          INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_conv_evt ON conversation_evenement(conversation_id, seq);
`;

/**
 * Migration 3 — compaction de contexte par conversation.
 *
 * `☠` Mesuré sur le SDK 0.3.217 : il n'existe AUCUNE API de compaction manuelle
 * (pas de méthode sur `Query`, pas de control request, et `/compact` envoyé dans
 * le flux est traité comme du texte ordinaire — le modèle y répond au lieu de
 * compacter). La compaction est donc faite PAR LE HARNESS : on demande un résumé
 * à la session, on la ferme, et la suivante redémarre amorcée par ce résumé.
 * D'où ces deux colonnes : le résumé à réinjecter, et le compte affiché à l'écran.
 *
 * `conversation_evenement` est recréée pour élargir son CHECK au type
 * `compaction` — SQLite ne sait pas modifier une contrainte en place. Les
 * `seq` sont préservés à l'identique : ce sont les curseurs de streaming, les
 * réattribuer ferait rejouer tout l'historique aux interfaces ouvertes.
 */
const MIGRATION_3 = `
ALTER TABLE conversation ADD COLUMN compactions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation ADD COLUMN resume_contexte TEXT;

CREATE TABLE conversation_evenement_nouveau (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('operateur', 'reflexion', 'texte', 'outil', 'resultat', 'erreur', 'compaction')),
  contenu         TEXT NOT NULL,
  cree_a          INTEGER NOT NULL
) STRICT;

INSERT INTO conversation_evenement_nouveau (seq, conversation_id, type, contenu, cree_a)
  SELECT seq, conversation_id, type, contenu, cree_a FROM conversation_evenement;

DROP TABLE conversation_evenement;
ALTER TABLE conversation_evenement_nouveau RENAME TO conversation_evenement;

CREATE INDEX idx_conv_evt ON conversation_evenement(conversation_id, seq);
`;

/**
 * Migration 4 — propositions de mandat (H-61).
 *
 * `☠` Avant cette table, `creer_equipe` rendait une proposition qui n'était
 * persistée NULLE PART : elle n'existait que dans la réponse faite à
 * l'orchestrateur. L'interface n'avait donc rien à afficher, et l'opérateur ne
 * pouvait rien autoriser — l'orchestrateur lui répétait « valide dans
 * l'interface » devant un écran sans bouton. H-61 exige une autorisation
 * humaine : encore faut-il que la demande survive au tour qui l'a produite.
 *
 * `conversation_evenement` est recréée pour accueillir le type `mandat`, qui
 * place la carte au bon endroit dans le fil. Les `seq` sont préservés — ce sont
 * les curseurs de streaming.
 */
const MIGRATION_4 = `
CREATE TABLE proposition (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversation(id) ON DELETE SET NULL,
  projet          TEXT NOT NULL,
  objectif        TEXT NOT NULL,
  critere_arret   TEXT,
  perimetre       TEXT NOT NULL,
  budget_max_usd  REAL NOT NULL,
  statut          TEXT NOT NULL DEFAULT 'en_attente'
                    CHECK (statut IN ('en_attente', 'approuvee', 'refusee')),
  mission_id      TEXT,
  detail          TEXT,
  cree_a          INTEGER NOT NULL,
  maj_a           INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_proposition_attente ON proposition(statut, cree_a DESC);

CREATE TABLE conversation_evenement_v4 (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('operateur', 'reflexion', 'texte', 'outil', 'resultat', 'erreur', 'compaction', 'mandat')),
  contenu         TEXT NOT NULL,
  cree_a          INTEGER NOT NULL
) STRICT;

INSERT INTO conversation_evenement_v4 (seq, conversation_id, type, contenu, cree_a)
  SELECT seq, conversation_id, type, contenu, cree_a FROM conversation_evenement;

DROP TABLE conversation_evenement;
ALTER TABLE conversation_evenement_v4 RENAME TO conversation_evenement;

CREATE INDEX idx_conv_evt ON conversation_evenement(conversation_id, seq);
`;

/**
 * Migration 5 — modèle et niveau de raisonnement choisis pour l'équipe.
 *
 * `☠` Le choix doit vivre sur la PROPOSITION, pas être décidé au dispatch :
 * l'opérateur autorise un mandat précis, modèle compris. Le décider après coup
 * ferait démarrer une équipe sur un modèle que personne n'a validé.
 */
const MIGRATION_5 = `
ALTER TABLE proposition ADD COLUMN modele TEXT;
ALTER TABLE proposition ADD COLUMN effort TEXT;
`;

/**
 * Migration 6 — ventilation du contexte par poste, telle que mesurée côté PC.
 *
 * `☠` Un seul pourcentage ne dit pas ce qu'il contient. Mesuré le 23/07 sur une
 * mission à 10 % : ~24 K de socle incompressible (prompt système, outils,
 * CLAUDE.md, skills) et ~79 K de travail réel. On décide un atterrissage sur
 * cette distinction — la perdre revient à décider à l'aveugle.
 *
 * Stockée en JSON : c'est une donnée d'affichage, jamais un critère de requête.
 * Une table dédiée coûterait une jointure pour rien.
 */
const MIGRATION_6 = `
ALTER TABLE mission ADD COLUMN contexte_ventilation TEXT;
`;

/**
 * Migration 7 — ce que l'équipe PRODUIT, pas seulement ce qu'elle devient.
 *
 * `☠` Le fil d'une mission ne portait que des transitions d'état et des
 * permissions. L'opérateur — et l'orchestrateur — n'avaient donc « que les états
 * et compteurs » : le rapport d'une équipe qui venait de terminer proprement
 * n'était visible NULLE PART (constaté le 23/07). Le texte existe pourtant, il
 * est observé côté PC ; il n'était simplement jamais rapatrié.
 */
const MIGRATION_7 = `
CREATE TABLE activite_mission (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL REFERENCES mission(id),
  texte TEXT NOT NULL,
  survenu_a INTEGER NOT NULL
);
CREATE INDEX idx_activite_mission ON activite_mission(mission_id, survenu_a);
`;

/**
 * Migration 8 — nature de chaque activité.
 *
 * `☠` Un fil qui ne montre que le texte final donne « mandat autorisé, sdk
 * running » et plus rien pendant qu'une équipe cherche pendant des minutes
 * (constaté le 23/07). L'opérateur veut voir les phases : ce que le lead
 * réfléchit, quels outils il lance, ce qu'il cherche. Les trois natures sont
 * distinguées parce que l'UI et le master ne les traitent PAS pareil — le
 * rapport de fin est un `texte`, jamais un appel d'outil.
 */
const MIGRATION_8 = `
ALTER TABLE activite_mission ADD COLUMN type TEXT NOT NULL DEFAULT 'texte';
ALTER TABLE activite_mission ADD COLUMN outil TEXT;
`;

/**
 * Jeton d'accès OAuth par compte, relevé sur le PC pour que le Pi sonde les
 * quotas lui-même en HTTP — c'est ce qui garde les jauges vivantes PC éteint.
 *
 * `☠` Jeton d'ACCÈS seulement (durée ~8 h). Le refresh token ne descend jamais
 * jusqu'ici : il est TOURNANT, le faire tourner hors du CLI casserait le compte.
 */
const MIGRATION_9 = `
CREATE TABLE IF NOT EXISTS jeton_compte (
  compte_id   TEXT PRIMARY KEY REFERENCES compte(id) ON DELETE CASCADE,
  jeton_acces TEXT NOT NULL,
  expire_a    INTEGER NOT NULL,
  releve_a    INTEGER NOT NULL
);
`;

/**
 * Sous-agents d'une mission, tels que le disque du PC les connaît.
 *
 * `☠` Dernier-gagne par (mission, agent) : c'est un ÉTAT COURANT rapatrié, pas
 * un journal. Accumuler les relevés ferait grossir la table de cinq lignes
 * toutes les 5 secondes pour la même équipe.
 */
const MIGRATION_10 = `
CREATE TABLE IF NOT EXISTS sous_agent_mission (
  mission_id      TEXT NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL,
  type            TEXT,
  description     TEXT,
  tool_use_id     TEXT,
  profondeur      INTEGER NOT NULL DEFAULT 1,
  statut          TEXT NOT NULL,
  derniere_action TEXT,
  maj_a           INTEGER NOT NULL,
  PRIMARY KEY (mission_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_sous_agent_mission ON sous_agent_mission(mission_id);
`;

/**
 * Fil de travail d'un sous-agent. `☠` Remplacé en bloc à chaque relevé, comme
 * `sous_agent_mission` : c'est un état courant rapatrié du disque du PC, pas un
 * journal. Sans cette table, cliquer sur un sous-agent rendait « Sous-agent
 * introuvable » — la vue n'avait que sa dernière action (constaté 23/07).
 */
const MIGRATION_11 = `
CREATE TABLE IF NOT EXISTS activite_sous_agent (
  mission_id TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  texte      TEXT NOT NULL,
  survenu_a  INTEGER NOT NULL,
  type       TEXT NOT NULL,
  outil      TEXT,
  rang       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activite_sous_agent ON activite_sous_agent(mission_id, agent_id, rang);
`;

/**
 * Modèle et effort d'une conversation orchestrateur.
 *
 * `☠` DEUX défauts réunis, constatés le 23/07 : (1) le choix de l'opérateur
 * n'était appliqué NULLE PART — `sendOrchestratorMessage` envoyait bien `model`
 * et `effort`, la route les jetait, et la session tournait sur sa constante ;
 * (2) rien n'était mémorisé, donc l'UI retombait sur Opus/high à chaque refresh,
 * en désaccord avec le message juste au-dessus.
 *
 * Sur la conversation : le DERNIER choix, pour rouvrir là où on s'était arrêté.
 * Sur l'évènement : ce qui a réellement produit CETTE réponse — un historique ne
 * se réécrit pas quand on change de modèle en cours de route.
 */
const MIGRATION_12 = `
ALTER TABLE conversation ADD COLUMN modele TEXT;
ALTER TABLE conversation ADD COLUMN effort TEXT;
ALTER TABLE conversation_evenement ADD COLUMN modele TEXT;
ALTER TABLE conversation_evenement ADD COLUMN effort TEXT;
`;

/**
 * L'accès d'un mandat devient une donnée, plus une phrase.
 *
 * `☠` Défaut `'lecture'` et non `'ecriture'` : les propositions antérieures sont
 * toutes tranchées, le défaut ne change donc rien pour elles — mais il fixe le
 * sens du doute pour tout ce qui viendrait ensuite sans préciser. Un accès
 * manquant doit RETIRER des droits, jamais en accorder.
 *
 * `perimetre` survit à côté : il reste la description libre du cadre de travail,
 * lue par le lead. Ce qu'on lui retire, c'est la charge de porter un droit —
 * qu'il n'a jamais portée autrement qu'en apparence (voir `shared/acces-mandat.ts`).
 */
const MIGRATION_13 = `
ALTER TABLE proposition ADD COLUMN acces TEXT NOT NULL DEFAULT 'lecture'
  CHECK (acces IN ('lecture','ecriture'));
`;

/**
 * Le canal asynchrone : un fait du parc peut enfin atteindre l'orchestrateur.
 *
 * `☠` Jusqu'ici RIEN ne pouvait lui parler. Sa conversation est un aller-retour
 * strict amorcé par l'opérateur, et aucune session ne tourne tant qu'il n'a pas
 * écrit. Une équipe qui finissait à 3 h du matin ne le réveillait donc pas :
 * elle restait `en_cours` au registre jusqu'à ce qu'un balayage de
 * réconciliation la déclare fantôme. « Je vais dormir, gère les équipes » était
 * impossible — non par choix d'architecture, par absence de câble.
 *
 * `mission.conversation_id` est ce câble : il dit QUELLE conversation a fait
 * naître cette équipe, donc où renvoyer la nouvelle. Nullable, et ce n'est pas
 * une anomalie : une mission peut naître hors conversation (restauration, test,
 * mandat-cadre à venir) — la notification est alors journalisée sans réveil.
 *
 * `notification` est écrite AVANT toute tentative de réveil et indépendamment
 * d'elle : un réveil qui échoue (session morte, quota épuisé, conversation
 * archivée) laisse le fait consultable au lieu de le perdre avec la tentative.
 * Même leçon que le bus d'escalade retiré le 31/07 — un événement dont la seule
 * trace est sa livraison n'existe plus quand la livraison rate.
 */
const MIGRATION_14 = `
ALTER TABLE mission ADD COLUMN conversation_id TEXT;

CREATE TABLE notification (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  mission_id      TEXT REFERENCES mission(id) ON DELETE CASCADE,
  conversation_id TEXT,
  titre           TEXT NOT NULL,
  corps           TEXT NOT NULL,
  cree_a          INTEGER NOT NULL,
  lu_a            INTEGER,
  remis_a         INTEGER,
  echec_remise    TEXT
);

CREATE INDEX idx_notification_non_lue ON notification(lu_a, cree_a);
CREATE INDEX idx_notification_conversation ON notification(conversation_id, cree_a);
`;

/**
 * L'autonomie devient une propriété du FIL, pas une exception ponctuelle.
 *
 * `☠` H-61 exigeait un clic humain pour CHAQUE équipe. Défendable tant que
 * l'orchestrateur ne faisait que proposer ; intenable dès qu'on lui demande de
 * tenir une plage de travail — à 3 h du matin, il attend un clic qui ne viendra
 * pas, et la plage est perdue.
 *
 * La règle de Chris (01/08) remplace le clic par un ENGAGEMENT : dans une
 * conversation, le PREMIER mandat se fait autoriser à la main ; les suivants
 * passent seuls. Ce que l'humain valide n'est plus une équipe, c'est une
 * intention de travail — et il la valide en connaissance de cause, puisqu'il
 * vient de lire le premier mandat.
 *
 * `origine_approbation` est le pivot : sans lui, impossible de savoir si un
 * humain a déjà tranché dans ce fil, donc impossible de décider — et impossible
 * de compter les auto-approbations pour les plafonner. Un drapeau booléen sur la
 * conversation aurait pu se désynchroniser ; ici l'état se DÉDUIT des faits.
 *
 * La fenêtre (`autonomie_debut` / `autonomie_fin`) porte la plage datée. Elle
 * autorise aussi le RÉVEIL d'une session endormie — le seul cas où le harness a
 * une raison de dépenser du quota sans que personne ne regarde. Sa fin est une
 * échéance annoncée à l'orchestrateur, pas seulement un interrupteur.
 */
const MIGRATION_15 = `
ALTER TABLE conversation ADD COLUMN autonomie_debut INTEGER;
ALTER TABLE conversation ADD COLUMN autonomie_fin INTEGER;
ALTER TABLE conversation ADD COLUMN autonomie_objectif TEXT;
ALTER TABLE proposition ADD COLUMN origine_approbation TEXT;
`;

/**
 * Les rappels programmés — l'orchestrateur peut enfin agir sur le TEMPS.
 *
 * `☠` Jusqu'ici il ne pouvait réagir qu'à deux choses : un message de Chris, et
 * la fin d'une équipe. Rien ne lui permettait de dire « refais ça dans dix
 * minutes ». Une consigne comme « toutes les 10 min, une synthèse des sorties IA
 * françaises » était donc structurellement impossible, quelle que soit sa bonne
 * volonté : il n'a aucune horloge, et sa session ne tourne même pas entre deux
 * messages.
 *
 * `conversation_id` NOT NULL, et c'est le cœur du modèle : un rappel appartient
 * à UN fil. Plusieurs rappels par conversation, indépendants les uns des autres,
 * et aucun ne fuit vers une autre conversation. Sans cette clé, un rappel posé
 * dans un fil de veille technique réveillerait le fil où tourne un chantier de
 * production.
 *
 * `periode_ms` NULL = rappel unique (one-shot) ; renseigné = récurrent. Les deux
 * partagent tout le reste — un one-shot est un récurrent qui se désactive après
 * son premier tir, pas un autre objet.
 *
 * `☠` `etat` est un ÉNUMÉRÉ, pas un booléen `actif`. Un booléen ne sait pas
 * distinguer « en pause, reprends-moi plus tard » de « terminé, n'y reviens
 * jamais » — et cette distinction est tout l'intérêt d'une pause. Avec un seul
 * bit, reprendre un rappel épuisé et reprendre un rappel suspendu deviennent le
 * même geste, et l'orchestrateur ressusciterait des one-shots déjà tirés.
 *
 * `prochaine_a` porte l'échéance ABSOLUE, jamais un délai : un délai relatif se
 * décale à chaque redémarrage du Pi, et un rappel de 10 minutes qui repart de
 * zéro à chaque déploiement ne se déclenche jamais.
 */
const MIGRATION_16 = `
CREATE TABLE rappel (
  id                       TEXT PRIMARY KEY,
  conversation_id          TEXT NOT NULL,
  libelle                  TEXT NOT NULL,
  consigne                 TEXT NOT NULL,
  prochaine_a              INTEGER NOT NULL,
  periode_ms               INTEGER,
  etat                     TEXT NOT NULL DEFAULT 'actif'
                             CHECK (etat IN ('actif', 'en_pause', 'termine')),
  declenchements           INTEGER NOT NULL DEFAULT 0,
  max_declenchements       INTEGER,
  dernier_declenchement_a  INTEGER,
  derniere_erreur          TEXT,
  cree_a                   INTEGER NOT NULL
);

CREATE INDEX idx_rappel_echeance ON rappel(etat, prochaine_a);
CREATE INDEX idx_rappel_conversation ON rappel(conversation_id, etat);
`;

/**
 * Le type d'évènement `notification` était accepté par TypeScript et REFUSÉ par
 * la base.
 *
 * `☠` Panne mesurée en prod le 2026-08-01, au premier canal asynchrone réel :
 *
 *     non transmis (registre: échec de « conversations.ajouterEvenement » —
 *     CHECK constraint failed: type IN ('operateur','reflexion','texte',
 *     'outil','resultat','erreur','compaction','mandat'))
 *
 * La migration 14 a ajouté `'notification'` à `TypeEvenementConversation` — le
 * type TS — sans toucher au CHECK SQL. Trois migrations avaient pourtant déjà
 * fait ce geste (compaction en 3, mandat en 4) : le motif était établi, je l'ai
 * oublié. Résultat : la notification était bien journalisée, Chris la voyait à
 * l'écran, mais sa remise à l'orchestrateur échouait au dernier maillon et la
 * conversation restait figée sur la fin d'équipe.
 *
 * `☠` Ce que la panne dit des tests : ceux du service utilisaient une doublure
 * de remise et n'écrivaient JAMAIS d'évènement réel. Ils validaient la fonction,
 * pas l'assemblage — exactement le défaut que ce dépôt documente depuis dix
 * occurrences. Le fail-safe, lui, a parfaitement joué : le fait a survécu, et
 * l'erreur SQL est arrivée telle quelle sous les yeux de l'opérateur.
 *
 * SQLite ne sait pas modifier un CHECK : la table est recréée et recopiée, comme
 * en migrations 3 et 4. `modele` et `effort` (migration 12) sont préservés.
 */
const MIGRATION_17 = `
CREATE TABLE conversation_evenement_v5 (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('operateur', 'reflexion', 'texte', 'outil',
                                                'resultat', 'erreur', 'compaction', 'mandat',
                                                'notification')),
  contenu         TEXT NOT NULL,
  cree_a          INTEGER NOT NULL,
  modele          TEXT,
  effort          TEXT
) STRICT;

INSERT INTO conversation_evenement_v5 (seq, conversation_id, type, contenu, cree_a, modele, effort)
  SELECT seq, conversation_id, type, contenu, cree_a, modele, effort FROM conversation_evenement;

DROP TABLE conversation_evenement;
ALTER TABLE conversation_evenement_v5 RENAME TO conversation_evenement;

CREATE INDEX idx_conv_evt ON conversation_evenement(conversation_id, seq);
`;


/**
 * Résultats d'appels d'outils (2026-08-01).
 *
 * `☠` Le fil montrait ce que le lead LANÇAIT, jamais ce que ça donnait : le
 * collecteur ignorait purement les messages `user` du SDK, qui portent les
 * `tool_result`. On lisait la question sans jamais la réponse.
 *
 * `outil_id` est le `tool_use_id` du SDK — la SEULE clé qui relie un appel à son
 * résultat, puisqu'ils arrivent dans deux messages distincts et que plusieurs
 * appels peuvent tourner de front. Indexé pour que l'appariement, qui se fait à
 * chaque balayage, reste un point d'index et non un balayage de table.
 */
const MIGRATION_18 = `
ALTER TABLE activite_mission ADD COLUMN outil_id TEXT;
ALTER TABLE activite_mission ADD COLUMN resultat TEXT;
ALTER TABLE activite_mission ADD COLUMN resultat_erreur INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_activite_outil_id ON activite_mission(outil_id);
`;

/**
 * D'où vient le titre d'un fil, donc qui a le droit de le changer ensuite.
 * `defaut` = jamais nommé · `auto` = l'orchestrateur l'a nommé une fois ·
 * `manuel` = un humain l'a posé.
 *
 * `☠` Les fils existants qui ne portent plus le libellé par défaut passent en
 * `manuel` : ils ont forcément été renommés à la main, puisque l'orchestrateur
 * n'avait pas encore d'outil pour le faire. Les laisser en `defaut` autoriserait
 * un nommage automatique à écraser un titre choisi par Chris.
 */
const MIGRATION_19 = `
ALTER TABLE conversation ADD COLUMN titre_source TEXT NOT NULL DEFAULT 'defaut';
UPDATE conversation SET titre_source = 'manuel' WHERE titre <> 'Nouvelle conversation';
`;

/**
 * Verdict d'inspection à la demande (H-68) et ce que l'opérateur en a fait.
 *
 * `☠` Le verdict était rendu côté PC et perdu aussitôt : `vue-missions.ts`
 * écrivait `inspection: { lastVerdict: null, lastAt: null }` EN DUR. Un
 * rafraîchissement de page effaçait donc l'avis qu'on venait de demander — et
 * le Parc ne pouvait rien en montrer.
 *
 * `☠` `inspection_decision` est le cœur : un verdict `boucle` ne coupe pas tout
 * seul, il ATTEND. `en_attente` → `confirme` (équipe arrêtée) ou `decline`
 * (équipe poursuivie en connaissance de cause). Sans cette colonne, « j'ai vu
 * l'alerte et je passe outre » serait indistinguable de « je n'ai pas vu ».
 */
const MIGRATION_20 = `
ALTER TABLE mission ADD COLUMN inspection_verdict TEXT;
ALTER TABLE mission ADD COLUMN inspection_motif TEXT;
ALTER TABLE mission ADD COLUMN inspection_a INTEGER;
ALTER TABLE mission ADD COLUMN inspection_decision TEXT;
`;

/**
 * Les appels d'outils de l'orchestrateur portent enfin leur RÉSULTAT.
 *
 * `☠` Jusqu'ici le fil affichait « Outil appelé : lire_fichier », suivi de la
 * mention « Le harness journalise l'appel, pas son résultat (H-45) ». Chris l'a
 * dit sans détour le 01/08 : montrer l'outil sans son résultat ne sert à rien.
 * Il a raison, et **H-45 était mal invoquée ici**. Cette règle interdit au flux
 * détaillé des SOUS-AGENTS de traverser le CONTEXTE de l'orchestrateur. Or ce
 * qu'on affiche là, ce sont les résultats de SES PROPRES appels : il les a déjà
 * dans son contexte, forcément, puisque c'est lui qui les a lancés. Les montrer
 * à l'écran ne lui ajoute pas un octet. La clause protégeait donc quelque chose
 * qui n'était pas en jeu, au prix d'un fil illisible.
 *
 * `tool_use_id` est une COLONNE et non une correspondance en mémoire : l'appel
 * et son résultat sont deux messages SDK distincts, séparés par l'exécution de
 * l'outil. Une map en mémoire ne survivrait pas à un redémarrage du control
 * plane, et les résultats en vol seraient perdus sans laisser de trace.
 */
const MIGRATION_21 = `
ALTER TABLE conversation_evenement ADD COLUMN tool_use_id TEXT;
ALTER TABLE conversation_evenement ADD COLUMN detail TEXT;
ALTER TABLE conversation_evenement ADD COLUMN resultat TEXT;
CREATE INDEX idx_conv_evt_tool ON conversation_evenement(tool_use_id);
`;

/**
 * Deux machines de travail simultanées : il faut désormais dire LAQUELLE.
 *
 * `☠` `mission.machine` n'est pas un confort d'affichage, c'est la condition
 * pour pouvoir ARRÊTER une équipe. Sans elle, un ordre d'arrêt ne sait à quelle
 * machine s'adresser : soit on le diffuse à toutes — et on tue potentiellement
 * une session homonyme ailleurs —, soit on ne l'envoie nulle part. Elle est
 * écrite AU DISPATCH, à partir de la machine réellement utilisée, jamais
 * déduite après coup : une déduction se tromperait précisément le jour où les
 * deux machines tournent.
 *
 * `☠` `NULL` = « non précisée », état légitime : toutes les conversations et
 * missions antérieures au 01/08 le portent. Il ne se résout qu'en l'ABSENCE
 * d'ambiguïté — une seule machine en ligne (`composition/pi/parc-
 * superviseurs.ts#resoudre`). Aucun rattrapage rétroactif n'est tenté ici :
 * mesuré sur le registre du Pi au moment d'écrire cette migration, ZÉRO mission
 * était active (36 missions, toutes terminales). Rien de vivant n'a donc besoin
 * d'être routé, et inventer une valeur pour l'historique serait une fabrication.
 */
const MIGRATION_22 = `
ALTER TABLE conversation ADD COLUMN machine TEXT;
ALTER TABLE mission ADD COLUMN machine TEXT;
CREATE INDEX idx_mission_machine ON mission(machine);
`;

/**
 * Migration 23 — l'état du dépôt d'une équipe à la fin de son tour.
 *
 * `☠` Ce que ces colonnes rendent possible : distinguer « a livré » de « a fini
 * de parler ». Jusqu'ici, une équipe qui rendait la main avec sept fichiers
 * modifiés et zéro commit était affichée exactement comme une équipe ayant
 * terminé — et la notification invitait à l'arrêter pour libérer le projet.
 *
 * `☠` Rien n'est rétro-rempli : le constat est un RELEVÉ daté, pas une déduction.
 * `git_releve_a` à NULL signifie « jamais mesuré », ce qui n'est pas « propre ».
 */
const MIGRATION_23 = `
ALTER TABLE mission ADD COLUMN git_fichiers_modifies INTEGER;
ALTER TABLE mission ADD COLUMN git_branche TEXT;
ALTER TABLE mission ADD COLUMN git_dernier_commit TEXT;
ALTER TABLE mission ADD COLUMN git_releve_a INTEGER;
`;

/**
 * Migration 24 — pièces jointes d'un message opérateur (2026-08-04).
 *
 * `☠` Les fichiers eux-mêmes ne sont PAS en base : seul leur descriptif JSON
 * l'est (nom d'origine, type, taille, nom du fichier écrit). Stocker les octets
 * ferait grossir le registre d'une capture par message — plusieurs Mo chacune,
 * relus intégralement à chaque ouverture de fil.
 *
 * `☠` Colonne portée par l'ÉVÉNEMENT et non par la conversation : une pièce
 * appartient au message qu'elle accompagne. Sur la conversation, elle
 * ressurgirait sur des messages qui ne l'ont jamais eue.
 */
const MIGRATION_24 = `
ALTER TABLE conversation_evenement ADD COLUMN pieces TEXT;
`;

/**
 * Migration 25 — un projet git peut porter plusieurs équipes (mandat câblage-worktree, E3).
 *
 * `☠` H-56 (une seule mission active par projet) ne s'applique plus qu'aux
 * projets NON-git. Un projet git accepte plusieurs équipes en parallèle,
 * chacune sur son propre `git worktree` — l'isolation qui manquait au projet
 * non-git, où deux équipes se marcheraient sur les mêmes fichiers sur disque.
 * L'index unique partiel est donc restreint aux lignes `projet_est_git = 0` :
 * la base n'empêche plus que la collision non-git, elle ne sait rien du
 * plafond git. Le plafond d'équipes simultanées sur un projet git (mandat E3)
 * est appliqué en APPLICATION (`dispatch-mandat.ts`), pas en base — la base
 * n'a aucun moyen de compter des worktrees qu'elle ne connaît pas.
 *
 * `DEFAULT 0` : toute mission historique est traitée comme non-git
 * rétroactivement, sans rattrapage — même motif qu'en migration 22 (mesuré à
 * l'époque : toutes les missions du registre étaient terminales, rien de
 * vivant à reclasser).
 */
const MIGRATION_25 = `
ALTER TABLE mission ADD COLUMN projet_est_git INTEGER NOT NULL DEFAULT 0 CHECK (projet_est_git IN (0, 1));

DROP INDEX idx_mission_active_par_projet;

CREATE UNIQUE INDEX idx_mission_active_par_projet
  ON mission(projet)
  WHERE etat_harness IN ('planifiee', 'en_cours', 'en_pause', 'attente_machine')
    AND projet_est_git = 0;
`;

/**
 * Migration 26 — le plafond d'autonomie devient réglable PAR FIL.
 *
 * `☠` Il était une constante compilée (`AUTO_APPROBATIONS_MAX = 40`) : le
 * changer imposait un redéploiement, c'est-à-dire couper l'orchestrateur en
 * pleine conversation. En pratique il ne changeait donc jamais.
 *
 * `☠` TEXT et non INTEGER, volontairement : la colonne doit porter trois états
 * distincts — `NULL` (rien réglé, le fil hérite du défaut de parc), le jeton
 * `illimite` (Chris a retiré le plafond DE CE FIL), ou un entier positif.
 * Confondre « non réglé » et « illimité » sous un même `NULL` rendrait un fil
 * délibérément affranchi indiscernable d'un fil neuf, et baisser le défaut de
 * parc reserrerait en silence des fils que Chris avait ouverts à la main.
 * Le CHECK refuse tout le reste À L'ÉCRITURE — une valeur folle ne s'installe
 * pas en base pour être arbitrée plus tard au point d'usage.
 */
const MIGRATION_26 = `
ALTER TABLE conversation ADD COLUMN plafond_autonomie TEXT
  CHECK (plafond_autonomie IS NULL
         OR plafond_autonomie = 'illimite'
         OR (CAST(plafond_autonomie AS INTEGER) > 0
             AND CAST(CAST(plafond_autonomie AS INTEGER) AS TEXT) = plafond_autonomie));
`;

/**
 * Migration 27 — demande de rallonge du plafond d'autonomie (H-58 conditionné).
 *
 * `☠` Ce n'est PAS une `proposition`. Approuver une proposition DISPATCHE une
 * équipe (H-61) ; approuver une rallonge ne fait qu'APPLIQUER un réglage déjà
 * décrit (migration 26) au fil qui l'a demandé — aucun worker, aucun worktree,
 * aucune dépense. Les confondre ferait relire « approuvée » comme « équipe
 * partie » sur une ligne qui n'a jamais rien lancé — le genre d'erreur de
 * lecture qui coûte cher précisément parce qu'elle est plausible.
 *
 * `☠` `plafond_demande` porte la MÊME forme que `conversation.plafond_autonomie`
 * (un entier positif en texte, ou le jeton `illimite`) — mais jamais `NULL` :
 * une demande de rallonge demande FORCÉMENT quelque chose, `herite` n'a aucun
 * sens ici (« demander d'hériter du défaut » n'est pas une rallonge, c'est un
 * non-geste). Le CHECK reprend celui de la migration 26 sans la branche NULL.
 *
 * `☠` `statut` est un ÉNUMÉRÉ à trois valeurs, jamais un booléen : une demande
 * refusée doit rester DISTINGUABLE d'une demande jamais tranchée, sinon un
 * second essai après refus se heurterait à la même garde « déjà en attente »
 * qu'un premier essai jamais vu par personne.
 *
 * L'index partiel sur les demandes en attente sert deux lectures à la fois :
 * la liste servie à l'écran (`GET /orchestrator/rallonges`), et la garde de
 * l'outil MCP qui refuse d'empiler une seconde demande sur le même fil tant
 * que la première n'est pas tranchée.
 */
const MIGRATION_27 = `
CREATE TABLE demande_rallonge (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  plafond_demande TEXT NOT NULL CHECK (
                    plafond_demande = 'illimite'
                    OR (CAST(plafond_demande AS INTEGER) > 0
                        AND CAST(CAST(plafond_demande AS INTEGER) AS TEXT) = plafond_demande)
                  ),
  motif           TEXT NOT NULL,
  statut          TEXT NOT NULL CHECK (statut IN ('en_attente', 'accordee', 'refusee')),
  cree_a          INTEGER NOT NULL,
  maj_a           INTEGER NOT NULL,
  detail          TEXT
) STRICT;

CREATE INDEX idx_demande_rallonge_attente ON demande_rallonge(statut, cree_a DESC);
`;

/**
 * Mode rapide, retenu par fil — exactement comme `modele` et `effort`
 * (migration 12), et pour la même raison : sans persistance, rouvrir un fil le
 * ramène à sa valeur d'usine et le réglage affiché ment.
 *
 * `☠` `NULL` n'est PAS `0`. `NULL` veut dire « ce fil n'a jamais tranché » et
 * laisse le défaut du compte s'appliquer ; `0` est le choix explicite de le
 * couper. Les confondre empêcherait de distinguer un fil neuf d'un fil où
 * l'opérateur l'a délibérément désactivé, et imposerait un `applyFlagSettings`
 * à chaque message d'un fil qui n'a jamais demandé ce réglage.
 *
 * `☠` Un entier, pas un booléen : SQLite STRICT n'a pas de type booléen, et un
 * texte `'true'`/`'false'` se compare mal.
 */
const MIGRATION_28 = `
ALTER TABLE conversation ADD COLUMN mode_rapide INTEGER CHECK (mode_rapide IN (0, 1));
`;

/**
 * Migration 29 — une demande de rallonge peut aussi porter une FENÊTRE.
 *
 * `☠` Réutilise `demande_rallonge` (migration 27) plutôt que `proposition`, et
 * la distinction est celle que la migration 27 énonce déjà : approuver une
 * `proposition` DISPATCHE une équipe (worker, worktree, dépense) ; approuver
 * une rallonge APPLIQUE un réglage au fil qui l'a demandée. Ouvrir une plage
 * d'autonomie est un réglage, pas un dispatch — même bouton, même garde « une
 * seule demande en attente par fil », même lecture pour Chris. Une troisième
 * table aurait dupliqué ce chemin pour rien.
 *
 * `☠` `plafond_demande` devient NULLABLE, ce qui impose une reconstruction de
 * table (SQLite ne sait pas relâcher un NOT NULL). C'est le prix d'un modèle
 * juste : une demande de plage ne demande PAS de changer le plafond, et
 * l'encoder en réécrivant le plafond effectif transformerait un fil en `herite`
 * en fil à valeur figée — il cesserait de suivre le défaut de parc sans que
 * personne ne l'ait décidé.
 *
 * Trois CHECK portent l'invariant plutôt qu'un commentaire :
 *   · une demande doit demander QUELQUE CHOSE (un plafond, ou une plage) ;
 *   · une plage est entière ou absente — un début sans fin serait une fenêtre
 *     ouverte pour toujours, exactement ce qu'une échéance existe pour fermer ;
 *   · elle se termine après avoir commencé.
 */
const MIGRATION_29 = `
ALTER TABLE demande_rallonge RENAME TO demande_rallonge_v27;
DROP INDEX idx_demande_rallonge_attente;

CREATE TABLE demande_rallonge (
  id                TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL,
  plafond_demande   TEXT CHECK (
                      plafond_demande IS NULL
                      OR plafond_demande = 'illimite'
                      OR (CAST(plafond_demande AS INTEGER) > 0
                          AND CAST(CAST(plafond_demande AS INTEGER) AS TEXT) = plafond_demande)
                    ),
  fenetre_debut     INTEGER,
  fenetre_fin       INTEGER,
  fenetre_objectif  TEXT,
  motif             TEXT NOT NULL,
  statut            TEXT NOT NULL CHECK (statut IN ('en_attente', 'accordee', 'refusee')),
  cree_a            INTEGER NOT NULL,
  maj_a             INTEGER NOT NULL,
  detail            TEXT,
  CHECK (plafond_demande IS NOT NULL OR fenetre_debut IS NOT NULL),
  CHECK ((fenetre_debut IS NULL) = (fenetre_fin IS NULL)),
  CHECK (fenetre_fin IS NULL OR fenetre_fin > fenetre_debut)
) STRICT;

INSERT INTO demande_rallonge
  (id, conversation_id, plafond_demande, fenetre_debut, fenetre_fin, fenetre_objectif,
   motif, statut, cree_a, maj_a, detail)
SELECT id, conversation_id, plafond_demande, NULL, NULL, NULL,
       motif, statut, cree_a, maj_a, detail
  FROM demande_rallonge_v27;

DROP TABLE demande_rallonge_v27;

CREATE INDEX idx_demande_rallonge_attente ON demande_rallonge(statut, cree_a DESC);
`;

/**
 * Migration 30 — type d'évènement `artefact` : un contenu que l'orchestrateur
 * produit lui-même (script shell/Python/Lua, page HTML) et qui s'affiche dans
 * le fil au lieu d'être noyé dans un bloc de texte.
 *
 * `☠` Même geste qu'en migrations 17 et 4 (H-17 documente déjà la panne : un
 * type ajouté au TS sans élargir le CHECK SQL écrit un fait que la base
 * refuse). SQLite ne sait pas modifier un CHECK : la table est recréée avec
 * TOUTES ses colonnes actuelles (`tool_use_id`, `detail`, `resultat`, `pieces`
 * — ajoutées après la dernière recréation, migrations 21 et 24), pas seulement
 * celles de la migration 17.
 */
const MIGRATION_30 = `
CREATE TABLE conversation_evenement_v30 (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('operateur', 'reflexion', 'texte', 'outil',
                                                'resultat', 'erreur', 'compaction', 'mandat',
                                                'notification', 'artefact')),
  contenu         TEXT NOT NULL,
  cree_a          INTEGER NOT NULL,
  modele          TEXT,
  effort          TEXT,
  tool_use_id     TEXT,
  detail          TEXT,
  resultat        TEXT,
  pieces          TEXT
) STRICT;

INSERT INTO conversation_evenement_v30
  (seq, conversation_id, type, contenu, cree_a, modele, effort, tool_use_id, detail, resultat, pieces)
SELECT seq, conversation_id, type, contenu, cree_a, modele, effort, tool_use_id, detail, resultat, pieces
  FROM conversation_evenement;

DROP TABLE conversation_evenement;
ALTER TABLE conversation_evenement_v30 RENAME TO conversation_evenement;

CREATE INDEX idx_conv_evt ON conversation_evenement(conversation_id, seq);
CREATE INDEX idx_conv_evt_tool ON conversation_evenement(tool_use_id);
`;

/**
 * Migration 31 — table `observation_parc` (garde 2, mandat opérateur 21/08).
 *
 * `☠` Une seule ligne, une seule clé : ce n'est pas un flux d'événements à
 * agréger (le carburant est aussi déjà journalisé, indirectement, dans
 * `conversation_evenement`), c'est l'ÉTAT COURANT « quand l'orchestrateur a-t-il
 * regardé le carburant pour la dernière fois », lu à CHAQUE `creer_equipe` et
 * écrit à CHAQUE `carburant_parc`. Une requête d'agrégation sur le flux
 * d'événements referait ce calcul à chaque dispatch — cette table le rend
 * O(1), cohérent avec le reste du registre (`compte`, `quota_compte`).
 */
const MIGRATION_31 = `
CREATE TABLE observation_parc (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  carburant_consulte_a INTEGER
) STRICT;

INSERT INTO observation_parc (id, carburant_consulte_a) VALUES (1, NULL);
`;

/**
 * Migration 32 — préavis de plafond (silence (a), mandat opérateur 21/08).
 *
 * `☠` `NULL` = préavis jamais envoyé, JAMAIS « déjà envoyé » — même convention
 * que `constatGit` (migration 23) : l'absence de mesure n'est pas la mesure
 * inverse. Sans cette colonne, le balayage de télémétrie (`balayage-telemetrie.ts`,
 * toutes les 5 s) renverrait le même avertissement à chaque tick une fois le
 * seuil de 80 % franchi, jusqu'à la coupure — un déluge de messages inutiles
 * au lead plutôt qu'un préavis unique.
 */
const MIGRATION_32 = `
ALTER TABLE mission ADD COLUMN avertissement_budget_80_a INTEGER;
`;

/**
 * Migration 33 — la latitude devient une colonne, pas seulement un paramètre en vol.
 *
 * `☠` Chantier 3 (mandat opérateur 24/08) : `creer_equipe` accepte `latitude`
 * depuis deux mandats, la carte d'autorisation l'affiche, `dispatch-mandat.ts`
 * sait déjà la lire — mais rien entre les deux ne l'écrivait en base. Le champ
 * valait donc toujours vide en production, et le lead ne le voyait jamais
 * (audit 24/08, trois équipes payées pour un maillon manquant). ADDITIF pur :
 * une colonne nullable, même patron que `perimetre` (migration 4) — texte libre,
 * aucun CHECK, aucune donnée réécrite, aucune table renommée.
 */
const MIGRATION_33 = `
ALTER TABLE proposition ADD COLUMN latitude TEXT;
`;

/**
 * Le compte choisi À LA MAIN pour le harness, et son verrou.
 *
 * `☠` Ligne UNIQUE (`CHECK (id = 1)`), insérée ici : une préférence « absente »
 * doit être un `compte_id NULL` lisible, jamais une table vide. Sans la ligne,
 * chaque lecteur devrait distinguer « pas encore réglé » de « table jamais
 * créée » — deux fois la même logique, à deux endroits, qui divergeront.
 *
 * `☠` Aucune clé étrangère vers `compte`. Les comptes sont ENREGISTRÉS PAR
 * OBSERVATION du disque des machines de travail (voir `decouverte-comptes.ts`) :
 * une préférence posée sur un compte momentanément absent de l'inventaire doit
 * survivre à son absence, pas être effacée par une cascade. Un `compte_id` qui
 * ne résout plus est traité comme une préférence inapplicable — dit à l'écran,
 * jamais silencieusement perdu.
 */
const MIGRATION_34 = `
CREATE TABLE preference_compte (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  compte_id  TEXT,
  verrouille INTEGER NOT NULL DEFAULT 0,
  maj_a      INTEGER NOT NULL
);
INSERT INTO preference_compte (id, compte_id, verrouille, maj_a) VALUES (1, NULL, 0, 0);
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, nom: 'schema-initial', sql: MIGRATION_1 },
  { version: 2, nom: 'conversations-orchestrateur', sql: MIGRATION_2 },
  { version: 3, nom: 'compaction-conversations', sql: MIGRATION_3 },
  { version: 4, nom: 'propositions-mandat', sql: MIGRATION_4 },
  { version: 5, nom: 'modele-effort-proposition', sql: MIGRATION_5 },
  { version: 6, nom: 'ventilation-contexte-mission', sql: MIGRATION_6 },
  { version: 7, nom: 'activite-mission', sql: MIGRATION_7 },
  { version: 8, nom: 'nature-activite-mission', sql: MIGRATION_8 },
  { version: 9, nom: 'jeton-oauth-compte', sql: MIGRATION_9 },
  { version: 10, nom: 'sous-agents-mission', sql: MIGRATION_10 },
  { version: 11, nom: 'activites-sous-agent', sql: MIGRATION_11 },
  { version: 12, nom: 'modele-effort-conversation', sql: MIGRATION_12 },
  { version: 13, nom: 'acces-mandat', sql: MIGRATION_13 },
  { version: 14, nom: 'notifications-canal-asynchrone', sql: MIGRATION_14 },
  { version: 15, nom: 'autonomie-fenetre-et-origine-approbation', sql: MIGRATION_15 },
  { version: 16, nom: 'rappels-programmes', sql: MIGRATION_16 },
  { version: 17, nom: 'evenement-notification', sql: MIGRATION_17 },
  { version: 18, nom: 'resultat-outil', sql: MIGRATION_18 },
  { version: 19, nom: 'source-titre-conversation', sql: MIGRATION_19 },
  { version: 20, nom: 'verdict-inspection-mission', sql: MIGRATION_20 },
  { version: 21, nom: 'resultats-outils-conversation', sql: MIGRATION_21 },
  { version: 22, nom: 'machine-de-travail', sql: MIGRATION_22 },
  { version: 23, nom: 'constat-git-mission', sql: MIGRATION_23 },
  { version: 24, nom: 'pieces-jointes-message', sql: MIGRATION_24 },
  { version: 25, nom: 'projet-est-git-mission', sql: MIGRATION_25 },
  { version: 26, nom: 'plafond-autonomie-par-fil', sql: MIGRATION_26 },
  { version: 27, nom: 'demande-rallonge-autonomie', sql: MIGRATION_27 },
  { version: 28, nom: 'mode-rapide-conversation', sql: MIGRATION_28 },
  { version: 29, nom: 'demande-rallonge-fenetre', sql: MIGRATION_29 },
  { version: 30, nom: 'evenement-artefact', sql: MIGRATION_30 },
  { version: 31, nom: 'observation-parc-carburant', sql: MIGRATION_31 },
  { version: 32, nom: 'avertissement-budget-80-mission', sql: MIGRATION_32 },
  { version: 33, nom: 'latitude-proposition', sql: MIGRATION_33 },
  { version: 34, nom: 'preference-compte', sql: MIGRATION_34 },
] as const;

export const VERSION_SCHEMA_CIBLE: number = MIGRATIONS.reduce(
  (max, m) => (m.version > max ? m.version : max),
  0,
);

export function versionSchema(db: Database): number {
  return executer('versionSchema', () => {
    const ligne = db.query<{ user_version: number }, []>('PRAGMA user_version').get();
    return ligne?.user_version ?? 0;
  });
}

/** Applique toutes les migrations manquantes, chacune dans sa propre transaction. */
export function migrer(db: Database): number {
  const depart = versionSchema(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= depart) continue;
    appliquer(db, migration);
  }
  const arrivee = versionSchema(db);
  if (arrivee !== depart) {
    journal.info({ depart, arrivee }, 'schéma du registre migré');
  }
  return arrivee;
}

function appliquer(db: Database, migration: Migration): void {
  executer(
    `migration:${migration.version}`,
    () => {
      db.transaction(() => {
        db.run(migration.sql);
        db.query(
          'INSERT INTO migration_appliquee (version, nom, applique_a) VALUES (?, ?, ?)',
        ).run(migration.version, migration.nom, Date.now());
        db.run(`PRAGMA user_version = ${migration.version}`);
      })();
    },
    { nom: migration.nom },
  );
}
