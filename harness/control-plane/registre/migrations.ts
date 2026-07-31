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
