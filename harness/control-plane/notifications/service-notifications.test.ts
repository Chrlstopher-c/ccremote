/**
 * Ce que ces tests prouvent, et pourquoi chacun existe :
 *  · le fait survit à une remise ratée (la raison d'être du dépôt) ;
 *  · une session endormie n'est PAS réveillée sans qu'on le demande (le quota) ;
 *  · le rattrapage rejoue ce qui n'a pas été remis, et une seule fois ;
 *  · une notification n'est jamais attribuée à Chris (H-66).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type Mission, type Proposition, type Registre } from '../registre/index.ts';
import { ServiceNotifications, type PortRemiseOrchestrateur } from './service-notifications.ts';
import { redigerFinEquipe, redigerMandatEnAttente } from './redaction.ts';

let repertoire: string;
let registre: Registre;

/** Journalise tout ce qui lui est remis ; peut être rendue active ou muette. */
class RemiseFactice implements PortRemiseOrchestrateur {
  public readonly recus: { conversationId: string; texte: string }[] = [];
  public active = true;
  public echoue: string | null = null;

  estActive(): boolean {
    return this.active;
  }

  async remettre(conversationId: string, texte: string): Promise<void> {
    if (this.echoue !== null) throw new Error(this.echoue);
    this.recus.push({ conversationId, texte });
  }
}

/**
 * `☠` Un projet DISTINCT par mission : H-56 n'autorise qu'une équipe active par
 * projet, et la contrainte est portée par un index UNIQUE — deux missions du
 * même projet font échouer l'insertion, pas le test qu'on croyait écrire.
 */
function creerMission(id: string, conversationId: string | null): Mission {
  registre.lots.creer({ id: `lot-${id}`, intention: 'objectif' });
  registre.missions.creer({
    id,
    lotId: `lot-${id}`,
    nom: `équipe ${id}`,
    projet: `projet-${id}`,
    compteId: 'compte1',
    conversationId,
  });
  registre.etats.appliquerEtatHarness(id, 'en_cours');
  const m = registre.missions.lire(id);
  if (m === null) throw new Error('mission absente après création');
  return m;
}

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'notifications-'));
  registre = ouvrirRegistre({ chemin: join(repertoire, 'registre.sqlite') });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-1' });
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoire, { recursive: true, force: true });
});

describe('journalisation avant remise', () => {
  test('le fait est écrit même quand la remise échoue', async () => {
    const remise = new RemiseFactice();
    remise.echoue = 'session morte';
    const service = new ServiceNotifications(registre, remise);

    const n = await service.signaler('equipe_terminee', creerMission('m1', 'conv-a'));

    expect(n).not.toBeNull();
    // `☠` Le cœur du dépôt : une remise ratée ne fait pas disparaître le fait.
    const enBase = registre.notifications.recentes();
    expect(enBase).toHaveLength(1);
    expect(enBase[0]?.remisA).toBeNull();
    expect(enBase[0]?.echecRemise).toBe('session morte');
  });

  test('un échec laisse la notification réessayable, jamais consommée', async () => {
    const remise = new RemiseFactice();
    remise.echoue = 'quota épuisé';
    const service = new ServiceNotifications(registre, remise);
    await service.signaler('equipe_terminee', creerMission('m1', 'conv-a'));

    // Elle doit encore apparaître comme non remise, sinon elle est perdue.
    expect(registre.notifications.nonRemises('conv-a')).toHaveLength(1);
  });
});

describe('politique de réveil', () => {
  test('session vivante : la remise part tout de suite', async () => {
    const remise = new RemiseFactice();
    const service = new ServiceNotifications(registre, remise);

    await service.signaler('equipe_terminee', creerMission('m1', 'conv-a'));

    expect(remise.recus).toHaveLength(1);
    expect(registre.notifications.recentes()[0]?.remisA).not.toBeNull();
  });

  test('session endormie : rien n’est réveillé sans demande explicite', async () => {
    const remise = new RemiseFactice();
    remise.active = false;
    const service = new ServiceNotifications(registre, remise);

    await service.signaler('equipe_terminee', creerMission('m1', 'conv-a'));

    // `☠` Le test qui protège le quota de la nuit : une fin d'équipe ne doit pas
    // démarrer une session à elle seule. Le fait attend, il n'est pas perdu.
    expect(remise.recus).toHaveLength(0);
    expect(registre.notifications.nonRemises('conv-a')).toHaveLength(1);
  });

  test('session endormie + reveiller: true : la remise a bien lieu', async () => {
    const remise = new RemiseFactice();
    remise.active = false;
    const service = new ServiceNotifications(registre, remise);

    await service.signaler('equipe_terminee', creerMission('m1', 'conv-a'), { reveiller: true });

    expect(remise.recus).toHaveLength(1);
  });

  test('mission sans conversation : journalisée, jamais remise à personne', async () => {
    const remise = new RemiseFactice();
    const service = new ServiceNotifications(registre, remise);

    await service.signaler('equipe_terminee', creerMission('m1', null));

    expect(remise.recus).toHaveLength(0);
    expect(registre.notifications.recentes()).toHaveLength(1);
  });
});

describe('rattrapage au réveil', () => {
  test('remet ce qui attendait, et ne le remet qu’une fois', async () => {
    const remise = new RemiseFactice();
    remise.active = false;
    const service = new ServiceNotifications(registre, remise);
    await service.signaler('equipe_terminee', creerMission('m1', 'conv-a'));
    await service.signaler('equipe_terminee', creerMission('m2', 'conv-a'));
    expect(remise.recus).toHaveLength(0);

    remise.active = true;
    const remises = await service.remettreEnAttente('conv-a');
    expect(remises).toBe(2);
    expect(remise.recus).toHaveLength(2);

    // Un second réveil ne doit rien rejouer : sinon l'orchestrateur relit à
    // chaque message toute l'histoire de la nuit.
    expect(await service.remettreEnAttente('conv-a')).toBe(0);
  });

  test('ne remet pas ce qui appartient à un autre fil', async () => {
    const remise = new RemiseFactice();
    remise.active = false;
    const service = new ServiceNotifications(registre, remise);
    await service.signaler('equipe_terminee', creerMission('m1', 'conv-a'));
    await service.signaler('equipe_terminee', creerMission('m2', 'conv-b'));

    remise.active = true;
    expect(await service.remettreEnAttente('conv-a')).toBe(1);
    expect(remise.recus[0]?.conversationId).toBe('conv-a');
  });

  test('s’arrête au premier échec plutôt que d’empiler les erreurs', async () => {
    const remise = new RemiseFactice();
    remise.active = false;
    const service = new ServiceNotifications(registre, remise);
    await service.signaler('equipe_terminee', creerMission('m1', 'conv-a'));
    await service.signaler('equipe_terminee', creerMission('m2', 'conv-a'));

    remise.active = true;
    remise.echoue = 'fil mort';
    expect(await service.remettreEnAttente('conv-a')).toBe(0);
    // Les deux restent à rejouer : rien n'a été consommé au passage.
    expect(registre.notifications.nonRemises('conv-a')).toHaveLength(2);
  });
});

describe('contenu remis à l’orchestrateur', () => {
  test('s’annonce comme venant du harness et porte l’identifiant exact (H-66)', async () => {
    const remise = new RemiseFactice();
    const service = new ServiceNotifications(registre, remise);

    await service.signaler('equipe_terminee', creerMission('m-42', 'conv-a'));

    const texte = remise.recus[0]?.texte ?? '';
    // `☠` Sans l'attribution, l'orchestrateur croit que Chris lui parle et
    // agit comme sur une instruction — la confusion que H-66 interdit.
    expect(texte).toContain('[HARNESS]');
    expect(texte).toContain('pas de Chris');
    // Sans l'identifiant, son premier geste utile coûte un aller-retour.
    expect(texte).toContain('m-42');
    expect(texte).toContain('rapport_equipe');
  });

  test('ne présente jamais une fin de tour comme un succès', async () => {
    const remise = new RemiseFactice();
    const service = new ServiceNotifications(registre, remise);

    await service.signaler('equipe_terminee', creerMission('m1', 'conv-a'));

    const texte = remise.recus[0]?.texte ?? '';
    expect(texte).toContain("pas que l'objectif est atteint");
  });
});

describe('journalisation sans remise (mandat en attente d’autorisation)', () => {
  test('écrit le fait, ne tente aucune remise même sur une session vivante', async () => {
    const remise = new RemiseFactice();
    remise.active = true;
    const service = new ServiceNotifications(registre, remise);

    const n = service.journaliserSansRemettre({
      type: 'mandat_en_attente',
      conversationId: 'conv-a',
      titre: 'Mandat en attente d’autorisation — projet-x',
      corps: 'objectif · raison',
    });

    expect(n).not.toBeNull();
    // `☠` Le cœur du chantier : le fil de l'orchestrateur ne reçoit RIEN,
    // même si sa session tourne déjà — contrairement à `signaler()`.
    expect(remise.recus).toHaveLength(0);
    const enBase = registre.notifications.recentes();
    expect(enBase).toHaveLength(1);
    expect(enBase[0]?.type).toBe('mandat_en_attente');
    expect(enBase[0]?.missionId).toBeNull();
    // La marque « non remise » que la base porte déjà — rien n'a été inventé.
    expect(enBase[0]?.remisA).toBeNull();
    expect(enBase[0]?.echecRemise).toBeNull();
  });

  test('reste marquée non remise après un réveil du fil — jamais rattrapée par erreur', async () => {
    const remise = new RemiseFactice();
    remise.active = false;
    const service = new ServiceNotifications(registre, remise);
    service.journaliserSansRemettre({
      type: 'mandat_en_attente',
      conversationId: 'conv-a',
      titre: 'Mandat en attente',
      corps: 'objectif · raison',
    });

    remise.active = true;
    // `☠` Sans mission dès l'origine — pas une mission purgée. Le rattrapage ne
    // doit ni l'envoyer (elle n'a pas de texte pour l'orchestrateur), ni la
    // marquer remise à tort (ça romprait la distinction lu/remis).
    const remises = await service.remettreEnAttente('conv-a');
    expect(remises).toBe(0);
    expect(remise.recus).toHaveLength(0);
    expect(registre.notifications.recentes()[0]?.remisA).toBeNull();
    // Toujours listée en attente : le rattrapage ne l'a pas consommée.
    expect(registre.notifications.nonRemises('conv-a')).toHaveLength(1);
  });
});

describe('marquage lu — indépendant de la remise', () => {
  test('lu par Chris ne veut pas dire remis à l’orchestrateur', async () => {
    const remise = new RemiseFactice();
    remise.active = false;
    const service = new ServiceNotifications(registre, remise);
    const n = await service.signaler('equipe_terminee', creerMission('m1', 'conv-a'));

    expect(registre.notifications.marquerLue(n?.id ?? '')).toBe(true);
    expect(registre.notifications.nombreNonLues()).toBe(0);
    // `☠` Deux destinataires, deux compteurs : Chris a lu, l'orchestrateur non.
    expect(registre.notifications.nonRemises('conv-a')).toHaveLength(1);
  });
});

/**
 * `☠` « Terminée » ne dit rien de ce que l'équipe a LIVRÉ. Ces cas verrouillent
 * la distinction que le harness ne faisait pas le 02/08 : rendre la main ≠ avoir
 * commité, et « non relevé » ≠ « propre ».
 */
describe('rédaction — travail non commité (migration 23)', () => {
  function missionAvecConstat(constat: Mission['constatGit']): Mission {
    const base = creerMission(`m-git-${constat === null ? 'nul' : constat.fichiersModifies}`, 'conv-a');
    return { ...base, constatGit: constat };
  }

  const MAINTENANT = 1_785_000_000_000;

  test('☠ fichiers non commités ⇒ le titre ET le corps le disent, avec le geste à faire', () => {
    const texte = redigerFinEquipe(
      missionAvecConstat({ fichiersModifies: 7, branche: 'travaux', dernierCommit: null, releveA: 1 }),
      MAINTENANT,
    );
    expect(texte.titre).toContain('non commitée');
    expect(texte.corps).toContain('7 fichier');
    expect(texte.pourOrchestrateur).toContain('NON COMMITÉ');
    expect(texte.pourOrchestrateur).toContain('envoyer_a_equipe');
  });

  test('dépôt propre ⇒ dit propre, avec le dernier commit', () => {
    const texte = redigerFinEquipe(
      missionAvecConstat({ fichiersModifies: 0, branche: 'main', dernierCommit: 'a1b2c3 · livré', releveA: 1 }),
      MAINTENANT,
    );
    expect(texte.titre).not.toContain('non commitée');
    expect(texte.pourOrchestrateur).toContain('propre');
    expect(texte.pourOrchestrateur).toContain('a1b2c3');
  });

  test('☠ relevé ABSENT ⇒ dit « non relevé », jamais « propre »', () => {
    const texte = redigerFinEquipe(missionAvecConstat(null), MAINTENANT);
    expect(texte.pourOrchestrateur).toContain('non relevé');
    expect(texte.pourOrchestrateur).not.toContain('ÉTAT DU DÉPÔT : propre');
  });
});

describe('rédaction — mandat en attente d’autorisation', () => {
  const PROPOSITION: Proposition = {
    id: 'prop-1',
    conversationId: 'conv-a',
    projet: 'projet-x',
    objectif: 'auditer la config nginx',
    critereArret: null,
    perimetre: 'lecture seule',
    acces: 'lecture',
    budgetMaxUsd: 5,
    modele: null,
    effort: null,
    latitude: null,
    statut: 'en_attente',
    missionId: null,
    detail: null,
    creeA: 1_785_000_000_000,
    majA: 1_785_000_000_000,
  };

  test('rédige un texte pour Chris, jamais pour l’orchestrateur (pas de Mission requise)', () => {
    const texte = redigerMandatEnAttente(PROPOSITION, "premier mandat de cette conversation : Chris l'autorise à la main.");
    expect(texte.titre).toContain('projet-x');
    expect(texte.titre).toContain('attente');
    expect(texte.corps).toContain('auditer la config nginx');
    expect(texte.corps).toContain("Chris l'autorise à la main");
    // `☠` Contrairement à `TexteNotification`, aucun champ `pourOrchestrateur` :
    // ce texte n'est structurellement pas destiné à ce chemin.
    expect('pourOrchestrateur' in texte).toBe(false);
  });
});
