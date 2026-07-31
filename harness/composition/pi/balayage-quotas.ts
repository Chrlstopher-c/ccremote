/**
 * Responsabilité : mesurer en continu, DEPUIS LE PI, l'usage des fenêtres de
 * rate limit de chaque compte, et l'écrire au registre.
 *
 * `☠` Pourquoi ça ne vit plus côté PC : la mesure passait par une session Claude
 * Code par compte (`superviseur/sonde-quotas.ts`), donc coûteuse, donc mise en
 * cache 10 min, donc un écran en retard de 10 min — et complètement figé dès que
 * le PC s'éteignait. L'endpoint OAuth ne demande qu'un jeton : le Pi peut le
 * faire lui-même, toutes les 20 s, gratuitement, PC allumé ou non.
 *
 * `☠` Le PC ne sert plus qu'à FOURNIR le jeton (il est le seul à avoir les
 * `CLAUDE_CONFIG_DIR`). Le jeton est persisté au registre, donc une extinction
 * du PC ne coupe rien tant qu'il n'a pas expiré (~8 h).
 *
 * `☠` Aucun refresh de jeton ici. Les refresh tokens sont TOURNANTS : en émettre
 * un depuis le Pi invaliderait celui du CLI et casserait le compte au prochain
 * démarrage. Jeton expiré ⇒ la jauge garde sa dernière valeur et la vue dit
 * depuis quand elle n'a plus été mesurée. Jamais un zéro inventé.
 */

import type { Registre } from '../../control-plane/registre/index.ts';
import { sonderQuotasHttp, type JetonCompte, type QuotaCompteMesure } from '../../superviseur/index.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'balayage-quotas' });

/**
 * `☠` Assez court pour que l'écran soit « à la seconde » à l'échelle d'une
 * fenêtre de 5 h, assez long pour ne pas marteler l'API. Aucune de ces requêtes
 * ne coûte NI token NI process — c'est ce qui a permis de quitter les 10 min de
 * la sonde SDK.
 *
 * `☠` C'était 20 s, et l'endpoint nous a mis en 429 CHRONIQUE : à raison de
 * deux comptes × deux endpoints, on émettait 12 requêtes/minute en continu,
 * 24 h/24, depuis le 24/07. Combiné à la rotation (un compte par passe) et à
 * l'abandon de `/profile`, une minute nous met à ~1 requête/minute — douze fois
 * moins. Chaque compte reste mesuré toutes les deux minutes, ce qui est
 * largement « temps réel » face à des fenêtres de 5 h et 7 jours.
 *
 * La leçon vaut au-delà des quotas : sonder plus souvent n'informe pas plus
 * quand la source rationne — ça finit par ne plus informer du tout.
 */
export const PERIODE_SONDE_QUOTAS_HTTP_MS = 60_000;

/** Les jetons sont relevés bien plus rarement que les quotas : ils vivent ~8 h. */
export const PERIODE_RELEVE_JETONS_MS = 300_000;

export interface SourceJetons {
  jetons(): Promise<readonly JetonCompte[]>;
}

export interface OptionsBalayageQuotas {
  readonly registre: Registre;
  /** Le PC. Absent ou injoignable ⇒ on sonde avec les jetons déjà persistés. */
  readonly source: SourceJetons;
  readonly periodeMs?: number;
  readonly periodeJetonsMs?: number;
  /** Injectable pour exercer la boucle sans toucher au réseau. Défaut : la sonde HTTP réelle. */
  readonly sonder?: (
    jetons: readonly JetonCompte[],
    maintenant?: number,
    avecProfil?: boolean,
  ) => Promise<readonly QuotaCompteMesure[]>;
}

export interface BalayageQuotas {
  arreter(): void;
  /** Exposé pour être déclenché à la demande (tests, banc réel). */
  passer(): Promise<void>;
}

/**
 * Écrit les jauges mesurées. `☠` Une mesure EN ÉCHEC n'écrit rien : écraser une
 * jauge connue par un zéro parce que la sonde a échoué ferait croire à un compte
 * disponible alors qu'il est peut-être saturé.
 */
function appliquer(registre: Registre, mesures: readonly QuotaCompteMesure[]): void {
  for (const mesure of mesures) {
    if (mesure.echec !== undefined) {
      log.debug({ compteId: mesure.compteId, echec: mesure.echec }, 'jauge non mesurée — valeur précédente conservée');
      continue;
    }
    registre.comptes.majIdentiteMesuree(mesure.compteId, mesure.email, mesure.typeAbonnement);
    for (const f of mesure.fenetres) {
      registre.comptes.releverQuota({
        compteId: mesure.compteId,
        typeFenetre: f.typeFenetre,
        // 100 % d'une fenêtre = compte réellement inutilisable : `listerDisponibles()`
        // doit l'écarter, sinon le prochain dispatch part droit dans le mur (H-53).
        statut: f.utilisation >= 100 ? 'rejected' : f.utilisation >= 80 ? 'allowed_warning' : 'allowed',
        utilisation: f.utilisation,
        resetA: f.resetA,
        utiliseOverage: mesure.creditsPayantsActifs,
        observeA: mesure.observeA,
      });
    }
  }
}

/**
 * Le compte du tour, et faut-il lui demander son profil.
 *
 * `☠ VÉCU DU 25 AU 31/07` — toute la liste était sondée à chaque passe. Sur un
 * endpoint qui rationne, deux comptes en concurrence signifient un gagnant et un
 * perdant TOUJOURS LES MÊMES : `compte-b` mesuré toutes les 20 s, `compte-a` pas
 * une fois en six jours, avec un 0 % affiché sur un compte réellement à 7-8 %.
 *
 * Un seul compte par passe, à tour de rôle : le trafic est divisé par le nombre
 * de comptes et aucun ne peut plus être affamé par un autre. Deux comptes ⇒
 * chacun mesuré toutes les 40 s, ce qui reste « à la seconde » à l'échelle d'une
 * fenêtre de 5 h.
 *
 * Le profil (email, abonnement) ne change jamais : on ne le redemande que tant
 * que l'identité manque, au lieu de doubler le trafic à chaque passe.
 */
function tourSuivant(
  jetons: readonly JetonCompte[],
  compteur: number,
  identiteConnue: (compteId: string) => boolean,
): { readonly jeton: JetonCompte; readonly avecProfil: boolean } | null {
  const jeton = jetons[compteur % jetons.length];
  if (jeton === undefined) return null;
  return { jeton, avecProfil: !identiteConnue(jeton.compteId) };
}

export function demarrerBalayageQuotas(options: OptionsBalayageQuotas): BalayageQuotas {
  const periode = options.periodeMs ?? PERIODE_SONDE_QUOTAS_HTTP_MS;
  const periodeJetons = options.periodeJetonsMs ?? PERIODE_RELEVE_JETONS_MS;
  const sonder = options.sonder ?? sonderQuotasHttp;
  let jetonsReleveA = 0;
  let enCours = false;
  let tour = 0;

  /** Identité déjà mesurée ⇒ le profil n'a plus rien à apprendre. */
  const identiteConnue = (compteId: string): boolean => {
    const compte = options.registre.comptes.lire(compteId);
    return compte !== null && compte.email !== null && compte.typeAbonnement !== null;
  };

  /**
   * Rafraîchit les jetons depuis le PC quand ils ont vieilli. `☠` N'efface
   * jamais ceux du registre sur un relevé vide : PC éteint est le régime
   * nominal (H-75), et c'est précisément le cas où les jetons persistés servent.
   */
  const releverJetons = async (): Promise<void> => {
    if (Date.now() - jetonsReleveA < periodeJetons) return;
    const releves = await options.source.jetons();
    // `☠` Un relevé VIDE ne compte pas comme un relevé : au démarrage, le lien
    // PC n'est pas encore ouvert et le client rend `[]` sans lever. Marquer
    // l'horodatage ici condamnerait le Pi à 5 min sans la moindre jauge, sur le
    // seul motif que le PC a mis trois secondes à se connecter.
    if (releves.length === 0) return;
    jetonsReleveA = Date.now();
    for (const j of releves) {
      options.registre.comptes.poserJeton(j.compteId, j.jetonAcces, j.expireA);
    }
  };

  const passer = async (): Promise<void> => {
    // `☠` Jamais deux passes concurrentes : une passe lente en chevaucherait une
    // autre et doublerait les requêtes sans rien mesurer de plus.
    if (enCours) return;
    enCours = true;
    try {
      try {
        await releverJetons();
      } catch (erreur) {
        log.debug({ err: erreur }, 'relevé de jetons impossible — les jetons persistés restent utilisables');
      }
      const jetons = options.registre.comptes.listerJetons();
      if (jetons.length === 0) return;
      const choix = tourSuivant(jetons, tour, identiteConnue);
      if (choix === null) return;
      tour += 1;
      appliquer(options.registre, await sonder([choix.jeton], Date.now(), choix.avecProfil));
    } catch (erreur) {
      log.debug({ err: erreur }, 'sonde de quotas indisponible — jauges laissées en l’état');
    } finally {
      enCours = false;
    }
  };

  const minuterie = setInterval(() => void passer(), periode);
  // Ne retient pas le process en vie : le lien et l'API font ça (Bun/Node).
  if (typeof minuterie.unref === 'function') minuterie.unref();

  return {
    arreter: (): void => clearInterval(minuterie),
    passer,
  };
}
