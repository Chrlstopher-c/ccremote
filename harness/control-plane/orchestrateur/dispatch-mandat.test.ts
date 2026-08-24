import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { PLANCHER_DENI_SDK } from '../../plancher-deni/motifs.ts';
import { OUTILS_ECRITURE, OUTILS_INTERACTION_HUMAINE } from '../../shared/acces-mandat.ts';
import {
  dispatcherMandat,
  ErreurPlafondEquipesProjetAtteint,
  ErreurProjetOccupe,
  PLAFOND_EQUIPES_PROJET_GIT_DEFAUT,
  type DependancesDispatch,
  type VerificationProjet,
} from './dispatch-mandat.ts';

let registre: Registre;

const PROPOSITION = {
  id: 'prop-1',
  projet: '/mnt/projects/vela',
  objectif: 'Auditer Vela',
  critereArret: 'rapport rendu',
  perimetre: 'lecture seule',
  budgetMaxUsd: 12,
  modele: null,
  effort: null,
} as never;

function deps(): DependancesDispatch {
  return {
    registre,
    demarreur: { demarrer: async () => ({ detail: 'équipe démarrée' }) } as never,
    repertoireProjets: '/mnt/projects',
  };
}

/** Sème une mission ACTIVE sur le projet — exactement ce que H-56 doit bloquer. */
function semerMissionActive(projet: string): string {
  registre.lots.creer({ id: 'lot-1', intention: 'précédente' });
  const m = registre.missions.creer({
    id: 'm-bloquante',
    lotId: 'lot-1',
    nom: 'précédente',
    projet,
    compteId: 'compte-a',
  });
  registre.etats.appliquerEtatHarness(m.id, 'en_cours');
  return m.id;
}

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/a' });
});

afterEach(() => registre.fermer());

describe('dispatch — une seule équipe active par projet (H-56)', () => {
  test('☠ refus NOMMÉ, jamais une contrainte SQLite en 500 « erreur interne »', async () => {
    const bloquante = semerMissionActive('/mnt/projects/vela');
    const erreur = await dispatcherMandat(PROPOSITION, deps()).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ErreurProjetOccupe);
    // Le message doit dire QUOI bloque et QUOI faire — sinon on clique trois
    // fois sans comprendre, ce qui est arrivé en prod le 23/07.
    expect((erreur as Error).message).toContain(bloquante.slice(0, 8));
    expect((erreur as Error).message).toContain('arreter_equipe');
  });

  test('☠ le contrôle a lieu AVANT toute écriture — aucun lot orphelin laissé derrière', async () => {
    semerMissionActive('/mnt/projects/vela');
    await dispatcherMandat(PROPOSITION, deps()).catch(() => undefined);
    expect(registre.lots.listerRecents().length).toBe(1); // le lot semé, et lui seul
  });

  test('une mission TERMINÉE ne bloque pas — le projet est libre', async () => {
    const bloquante = semerMissionActive('/mnt/projects/vela');
    registre.etats.appliquerEtatHarness(bloquante, 'terminee');
    const r = await dispatcherMandat(PROPOSITION, deps());
    expect(r.missionId).toBeDefined();
  });

  test('un AUTRE projet n’est jamais bloqué par celui-ci', async () => {
    semerMissionActive('/mnt/projects/nullnode');
    const r = await dispatcherMandat(PROPOSITION, deps());
    expect(r.missionId).toBeDefined();
  });
});

describe('☠ l’epoch de fencing CROÎT réellement d’un dispatch à l’autre', () => {
  /** Termine la mission pour libérer le projet (H-56) sans effacer son epoch. */
  function terminer(missionId: string): void {
    registre.etats.appliquerEtatHarness(missionId, 'terminee');
  }

  test('deux dispatchs successifs sur le même projet ne portent pas le même epoch', async () => {
    const epochsEnvoyes: number[] = [];
    const depsTracantes = (): DependancesDispatch => ({
      ...deps(),
      demarreur: {
        demarrer: async (d: { epoch: number }) => {
          epochsEnvoyes.push(d.epoch);
          return { detail: 'ok' };
        },
      } as never,
    });

    const un = await dispatcherMandat(PROPOSITION, depsTracantes());
    terminer(un.missionId);
    const deux = await dispatcherMandat(PROPOSITION, depsTracantes());

    // Le défaut vécu : la colonne restait à 0, `prochainEpoch` rendait donc
    // toujours 1 et les deux workers portaient le MÊME epoch — précisément ce
    // que le fencing (M-11) doit rejeter.
    expect(epochsEnvoyes).toEqual([1, 2]);
    expect(registre.missions.lire(un.missionId)?.epoch).toBe(1);
    expect(registre.missions.lire(deux.missionId)?.epoch).toBe(2);
  });

  test('☠ l’epoch ENVOYÉ au PC est celui ÉCRIT au registre — deux calculs divergeraient', async () => {
    let envoye = -1;
    const d: DependancesDispatch = {
      ...deps(),
      demarreur: {
        demarrer: async (dem: { epoch: number }) => {
          envoye = dem.epoch;
          return { detail: 'ok' };
        },
      } as never,
    };
    const r = await dispatcherMandat(PROPOSITION, d);
    expect(registre.missions.lire(r.missionId)?.epoch).toBe(envoye);
  });

  test('un projet DIFFÉRENT repart à 1 — le fencing est par worktree, pas global', async () => {
    const premier = await dispatcherMandat(PROPOSITION, deps());
    terminer(premier.missionId);
    const autreProposition = { ...(PROPOSITION as object), projet: '/mnt/projects/agora' } as never;
    const autre = await dispatcherMandat(autreProposition, deps());
    expect(registre.missions.lire(autre.missionId)?.epoch).toBe(1);
  });

  test('☠ l’epoch ne REDESCEND pas quand d’autres projets saturent la fenêtre de récence', async () => {
    const premier = await dispatcherMandat(PROPOSITION, deps());
    terminer(premier.missionId);
    expect(registre.missions.lire(premier.missionId)?.epoch).toBe(1);

    // `listerRecentes()` ne rend que les 200 dernières missions, TOUS projets
    // confondus, triées par activité. Passé ce seuil la mission ci-dessus en
    // sort, et un maximum calculé sur cette fenêtre retombe à 0 : le dispatch
    // suivant réémettrait l'epoch 1 et le fencing (M-11) tuerait le worker.
    registre.lots.creer({ id: 'lot-bruit', intention: 'bruit' });
    for (let i = 0; i < 250; i += 1) {
      const m = registre.missions.creer({
        id: `bruit-${i}`,
        lotId: 'lot-bruit',
        nom: 'bruit',
        projet: '/mnt/projects/autre',
        compteId: 'compte-a',
      });
      registre.etats.appliquerEtatHarness(m.id, 'terminee');
    }

    const second = await dispatcherMandat(PROPOSITION, deps());
    expect(registre.missions.lire(second.missionId)?.epoch).toBe(2);
  });
});

describe('☠ l’accès du mandat est un DROIT posé sur le worker, pas une phrase', () => {
  /** Capture ce qui part RÉELLEMENT vers le PC — seul artefact qui fasse foi. */
  async function dispatcher(acces?: string): Promise<{
    readonly denis: readonly string[];
    readonly prompt: string;
  }> {
    let denis: readonly string[] = [];
    let prompt = '';
    const d: DependancesDispatch = {
      ...deps(),
      demarreur: {
        demarrer: async (dem: {
          promptInitial: string;
          parametres: { deniedToolPatterns: readonly string[] };
        }) => {
          denis = dem.parametres.deniedToolPatterns;
          prompt = dem.promptInitial;
          return { detail: 'ok' };
        },
      } as never,
    };
    const proposition = { ...(PROPOSITION as object), acces } as never;
    await dispatcherMandat(proposition, d);
    return { denis, prompt };
  }

  test('☠ le PLANCHER de déni part sur TOUT dispatch, quel que soit l’accès', async () => {
    // Le défaut vécu : le seul site de dispatch réel n'alimente pas
    // `deps.deniedToolPatterns`, donc `?? []` rendait un tableau vide et
    // `disallowedTools` était vide sur le worker. Le plancher existait, était
    // testé, et ne protégeait rien — y compris `~/.ssh` et `.credentials.json`.
    for (const acces of ['lecture', 'ecriture']) {
      const { denis } = await dispatcher(acces);
      for (const motif of PLANCHER_DENI_SDK) expect(denis).toContain(motif);
      registre.etats.appliquerEtatHarness(
        registre.missions.listerActives()[0]?.id ?? '',
        'terminee',
      );
    }
  });

  test('`lecture` refuse RÉELLEMENT les outils d’écriture de fichiers', async () => {
    const { denis, prompt } = await dispatcher('lecture');
    for (const outil of OUTILS_ECRITURE) expect(denis).toContain(outil);
    expect(prompt).toContain('LECTURE SEULE');
    // ☠ Bash reste ouvert même en lecture (décision Chris, 31/07) : explorer au
    // shell est le mode de travail normal d'un agent d'exploration.
    expect(denis).not.toContain('Bash');
  });

  test('`ecriture` n’ajoute aucun refus d’écriture — une équipe de modification travaille', async () => {
    const { denis, prompt } = await dispatcher('ecriture');
    for (const outil of OUTILS_ECRITURE) expect(denis).not.toContain(outil);
    expect(denis).toEqual([...PLANCHER_DENI_SDK, ...OUTILS_INTERACTION_HUMAINE]);
    expect(prompt).toContain('lecture et écriture');
  });

  test('☠ aucune équipe ne peut interroger un humain, quel que soit son accès', async () => {
    // Personne ne regarde le flux d'une équipe qui travaille : une question
    // posée là n'atteint personne. Ce qu'un lead ne sait pas trancher, il
    // l'écrit dans son rapport — l'orchestrateur en fera un nouveau mandat.
    for (const acces of ['lecture', 'ecriture']) {
      const { denis } = await dispatcher(acces);
      for (const outil of OUTILS_INTERACTION_HUMAINE) expect(denis).toContain(outil);
      registre.etats.appliquerEtatHarness(
        registre.missions.listerActives()[0]?.id ?? '',
        'terminee',
      );
    }
  });

  test('☠ un accès ABSENT ou illisible retombe sur la lecture — jamais sur l’écriture', async () => {
    for (const valeur of [undefined, '', 'admin', 'lecture+']) {
      const { denis, prompt } = await dispatcher(valeur);
      expect(denis).toContain('Write');
      expect(prompt).toContain('LECTURE SEULE');
      registre.etats.appliquerEtatHarness(
        registre.missions.listerActives()[0]?.id ?? '',
        'terminee',
      );
    }
  });
});

/**
 * `☠` Les deux cas qui comptent (mandat E3) : un projet NON-git refuse
 * TOUJOURS une seconde équipe (H-56 stricte, inchangée) ; un projet GIT
 * l'accepte jusqu'à un plafond, refusé explicitement au-delà. `deps()`
 * (au-dessus) n'injecte aucun `verifierProjet` : `estGit` y retombe donc à
 * `false` par défaut — c'est déjà ce que couvre `describe` H-56 plus haut.
 */
describe('dispatch — H-56 conditionné au caractère git du projet (E3)', () => {
  function depsAvecVerdict(estGit: boolean, plafond?: number): DependancesDispatch {
    return {
      ...deps(),
      verifierProjet: async (): Promise<VerificationProjet> => ({ present: true, estGit }),
      ...(plafond === undefined ? {} : { plafondEquipesParProjet: plafond }),
    };
  }

  test('☠ un projet GIT accepte une SECONDE équipe là où H-56 stricte l’aurait refusée', async () => {
    semerMissionActive('/mnt/projects/vela');
    const r = await dispatcherMandat(PROPOSITION, depsAvecVerdict(true));
    expect(r.missionId).toBeDefined();
  });

  test('☠ le MÊME projet, non-git, refuse encore — preuve dans les deux sens sur une seule garde', async () => {
    semerMissionActive('/mnt/projects/vela');
    // Sens « casse » : estGit=true fait passer le dispatch (test précédent).
    // Sens « restaure » : estGit=false (défaut) fait revenir le refus — même
    // projet, même mission bloquante, seul le verdict git change.
    const erreur = await dispatcherMandat(PROPOSITION, depsAvecVerdict(false)).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ErreurProjetOccupe);
  });

  test(`accepte jusqu’au plafond (${PLAFOND_EQUIPES_PROJET_GIT_DEFAUT}), refuse explicitement au-delà`, async () => {
    const d = depsAvecVerdict(true);
    for (let i = 0; i < PLAFOND_EQUIPES_PROJET_GIT_DEFAUT; i++) {
      const r = await dispatcherMandat(PROPOSITION, d);
      expect(r.missionId).toBeDefined();
    }
    const erreur = await dispatcherMandat(PROPOSITION, d).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ErreurPlafondEquipesProjetAtteint);
    expect((erreur as Error).message).toContain(String(PLAFOND_EQUIPES_PROJET_GIT_DEFAUT));
  });

  test('le plafond est CONFIGURABLE — un plafond de 1 refuse dès la deuxième équipe', async () => {
    const d = depsAvecVerdict(true, 1);
    const premiere = await dispatcherMandat(PROPOSITION, d);
    expect(premiere.missionId).toBeDefined();
    const erreur = await dispatcherMandat(PROPOSITION, d).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ErreurPlafondEquipesProjetAtteint);
  });

  test('une mission terminée libère un emplacement du plafond git', async () => {
    const d = depsAvecVerdict(true, 1);
    const premiere = await dispatcherMandat(PROPOSITION, d);
    registre.etats.appliquerEtatHarness(premiere.missionId, 'terminee');
    const deuxieme = await dispatcherMandat(PROPOSITION, d);
    expect(deuxieme.missionId).toBeDefined();
  });

  test('un projet ABSENT du verdict git (verifierProjet non fourni) reste mono-équipe par défaut', async () => {
    semerMissionActive('/mnt/projects/vela');
    // `deps()` seul, sans `verifierProjet` — comportement de tout appelant qui
    // n'a jamais été mis à jour (tests existants, restauration…).
    const erreur = await dispatcherMandat(PROPOSITION, deps()).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ErreurProjetOccupe);
  });

  test('☠ le worktree RÉELLEMENT alloué (réponse du PC) est écrit au registre', async () => {
    // Le PC peut allouer un chemin distinct de celui envoyé au dispatch — voir
    // `SuperviseurWorkers.demarrer()` (câblage E2) — c'est ce que `definirWorktree`
    // doit refléter, jamais le `cwd` provisoire composé côté Pi.
    const d: DependancesDispatch = {
      ...depsAvecVerdict(true),
      demarreur: {
        demarrer: async () => ({
          detail: 'ok',
          worktree: { chemin: '/mnt/projects/.worktrees/equipe-xyz', branche: 'equipe/xyz' },
        }),
      } as never,
    };
    const r = await dispatcherMandat(PROPOSITION, d);
    const mission = registre.missions.lire(r.missionId);
    expect(mission?.worktree).toBe('/mnt/projects/.worktrees/equipe-xyz');
    expect(mission?.branche).toBe('equipe/xyz');
  });

  test('sans champ `worktree` dans la réponse du PC (mode dégradé), le worktree provisoire est conservé', async () => {
    const d: DependancesDispatch = {
      ...depsAvecVerdict(false),
      demarreur: { demarrer: async () => ({ detail: 'ok' }) } as never,
    };
    const r = await dispatcherMandat(PROPOSITION, d);
    const mission = registre.missions.lire(r.missionId);
    // `definirWorktree` n'est PAS appelé — le worktree reste celui composé à la
    // création (le `cwd` provisoire, ici le projet lui-même, mode dégradé).
    expect(mission?.worktree).toBe('/mnt/projects/vela');
  });
});

/**
 * `☠` Mesuré le 18/08 : quatre mandats morts au démarrage, zéro événement au
 * fil, l'orchestrateur n'a rien vu et a posé un diagnostic faux. Ce que ces
 * tests vérifient : le même échec qui ferme la mission (`echec_definitif`) et
 * libère le projet doit AUSSI produire un événement visible, sur le même
 * patron que les fins d'équipe existantes (`signalerFinEquipe`).
 */
describe('dispatch — démarrage refusé (rollback) notifie, comme les fins d’équipe', () => {
  function depsQuiEchoue(
    appels: { missionId: string; motif: string }[],
  ): DependancesDispatch {
    return {
      registre,
      demarreur: {
        demarrer: async () => {
          throw new Error('PC injoignable');
        },
      } as never,
      repertoireProjets: '/mnt/projects',
      signalerEchecDemarrage: async (missionId: string, motif: string) => {
        appels.push({ missionId, motif });
      },
    };
  }

  test('☠ un démarrage refusé déclenche la notification câblée, avec le motif exact', async () => {
    const appels: { missionId: string; motif: string }[] = [];
    const erreur = await dispatcherMandat(PROPOSITION, depsQuiEchoue(appels)).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(Error);
    expect(appels).toHaveLength(1);
    expect(appels[0]?.motif).toBe('PC injoignable');
    // La mission notifiée est bien celle que le rollback vient de fermer.
    const mission = registre.missions.lire(appels[0]!.missionId);
    expect(mission?.etatHarness).toBe('echec_definitif');
  });

  test('sans câblage (défaut historique), le rollback ne casse pas — mission close, projet libéré', async () => {
    const erreur = await dispatcherMandat(PROPOSITION, {
      registre,
      demarreur: { demarrer: async () => { throw new Error('PC injoignable'); } } as never,
      repertoireProjets: '/mnt/projects',
    }).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(Error);
    // Une seconde équipe peut redémarrer sur ce projet : le rollback a bien
    // libéré l'emplacement, câblage de notification ou non.
    const seconde = await dispatcherMandat(PROPOSITION, deps());
    expect(seconde.missionId).toBeDefined();
  });

  test('☠ un échec DE LA NOTIFICATION ELLE-MÊME n’empêche jamais le rollback de se terminer', async () => {
    const d: DependancesDispatch = {
      registre,
      demarreur: { demarrer: async () => { throw new Error('PC injoignable'); } } as never,
      repertoireProjets: '/mnt/projects',
      signalerEchecDemarrage: async () => {
        throw new Error('service de notifications indisponible');
      },
    };
    const erreur = await dispatcherMandat(PROPOSITION, d).catch((e: unknown) => e);
    // L'erreur relancée est celle du DÉMARRAGE, pas celle de la notification —
    // le rollback n'est jamais masqué par un échec du canal de notification.
    expect((erreur as Error).message).toBe('PC injoignable');
  });
});

/**
 * `☠` Chantier 3 (mandat opérateur 24/08) — le champ existait déjà, validé,
 * stocké côté carte d'autorisation (`mcp-controle/mandat.ts`), mais une équipe
 * lancée sans clic (le cas le plus fréquent) ne voyait JAMAIS sa latitude :
 * cette composition-ci, celle qui devient réellement le `systemPrompt` du
 * worker, ne lisait pas le champ. Le champ était mort là où il devait servir.
 */
describe('☠ la latitude (chantier 3) atteint le briefing RÉELLEMENT transmis au lead', () => {
  /** Capture ce qui part VRAIMENT vers le PC — seul artefact qui fasse foi. */
  async function dispatcher(latitude?: string | null): Promise<string> {
    let mandate = '';
    const d: DependancesDispatch = {
      ...deps(),
      demarreur: {
        demarrer: async (dem: { parametres: { mandate: string } }) => {
          mandate = dem.parametres.mandate;
          return { detail: 'ok' };
        },
      } as never,
    };
    const proposition = { ...(PROPOSITION as object), latitude } as never;
    await dispatcherMandat(proposition, d);
    return mandate;
  }

  test('renseignée, elle apparaît dans le briefing — AUTORISE, jamais confondue avec le périmètre', async () => {
    const briefing = await dispatcher('la configuration CI voisine, si elle bloque le déploiement du projet');
    expect(briefing).toContain(
      'Latitude (choses adjacentes que tu es autorisé à corriger SI tu les rencontres — ' +
        "le périmètre l'emporte TOUJOURS en cas de recouvrement) : " +
        'la configuration CI voisine, si elle bloque le déploiement du projet',
    );
    // Elle vit à côté du périmètre, jamais confondue avec lui : l'un INTERDIT,
    // l'autre AUTORISE, dit sans ambiguïté au lead qui lira les deux lignes.
    expect(briefing.indexOf('Périmètre :')).toBeLessThan(briefing.indexOf('Latitude ('));
  });

  test('absente (undefined) — aucune section, aucune phrase parasite', async () => {
    const briefing = await dispatcher(undefined);
    expect(briefing).not.toContain('Latitude');
  });

  test('absente (null explicite) — même absence de section', async () => {
    const briefing = await dispatcher(null);
    expect(briefing).not.toContain('Latitude');
  });

  test('vide ou blanche — traitée comme absente, jamais une section vide', async () => {
    const briefing = await dispatcher('   ');
    expect(briefing).not.toContain('Latitude');
  });
});
