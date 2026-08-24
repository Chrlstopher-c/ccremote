/**
 * Responsabilité : choisir sur QUEL compte l'orchestrateur maître démarre, à
 * partir des quotas RÉELLEMENT mesurés — jamais « toujours le premier ».
 *
 * `☠ VÉCU LE 23/07` — l'index de rotation vivait en mémoire et repartait à 0 à
 * chaque redémarrage du Pi. Le compte A étant à 100 % de sa fenêtre
 * hebdomadaire, chaque déploiement renvoyait l'orchestrateur droit dans le mur :
 * l'opérateur écrivait, recevait « You've hit your weekly limit », et devait
 * réécrire pour que la bascule se fasse. À chaque redémarrage.
 *
 * On dispose pourtant de la mesure : la sonde OAuth (`balayage-quotas.ts`) tient
 * les jauges à jour toutes les 20 s, PC allumé ou non. Autant s'en servir pour
 * démarrer du bon côté plutôt que de découvrir le mur en le heurtant.
 *
 * `☠` Le lien entre un dossier de config et un compte du registre est l'EMAIL,
 * lu dans le `.claude.json` que le CLI écrit (`oauthAccount.emailAddress`). Les
 * chemins, eux, ne se correspondent pas : le registre connaît les dossiers du PC
 * (`/home/trinity/.claude-comptes/…`), l'orchestrateur vit sur le Pi
 * (`/home/pi/.claude-orchestrateur…`) — ce sont les mêmes comptes Claude sous
 * des chemins différents.
 *
 * `☠` Un compte dont on ne sait RIEN n'est jamais écarté : inconnu ≠ saturé.
 * Écarter sur une ignorance coûterait la capacité entière ; au pire on heurte
 * le mur une fois, ce qui est exactement l'état d'avant.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Registre } from '../../control-plane/registre/index.ts';
import { fenetreEncoreSaturante } from '../../shared/saturation-compte.ts';
import { resoudrePreference } from '../../shared/preference-compte.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'choix-compte-orchestrateur' });

/** Email du compte connecté dans ce dossier de config, ou `null` si illisible. */
export function emailDuConfigDir(configDir: string): string | null {
  try {
    const brut = JSON.parse(readFileSync(join(configDir, '.claude.json'), 'utf8')) as {
      oauthAccount?: { emailAddress?: string };
    };
    const email = brut.oauthAccount?.emailAddress;
    return typeof email === 'string' && email.length > 0 ? email : null;
  } catch {
    return null;
  }
}

/**
 * `true` si le registre SAIT que ce compte est saturé. `☠` Trois états, pas
 * deux : saturé / disponible / inconnu — et l'inconnu se comporte comme
 * disponible (voir l'en-tête).
 */
function estSature(registre: Registre, email: string | null, maintenant: number = Date.now()): boolean {
  if (email === null) return false;
  const compte = registre.comptes.lister().find((c) => c.email === email);
  if (compte === undefined) return false;
  // `☠` La fin de fenêtre compte autant que le verdict : voir `fenetreEncoreSaturante`.
  // Un `rejected` dont le reset est passé écartait le compte des jours durant.
  return registre.comptes.listerQuotas(compte.id).some((q) => fenetreEncoreSaturante(q, maintenant));
}

/**
 * Index du premier compte que le registre ne tient pas pour saturé, en partant
 * de `depuis`. Rend `depuis` quand tous le sont : on ne prétend pas avoir trouvé
 * mieux, l'appelant heurtera le mur et le dira — c'est plus honnête qu'un choix
 * arbitraire présenté comme une solution.
 */
/**
 * Identifiant de registre du compte connecté dans ce dossier, ou `null`.
 *
 * `☠` Le pont entre les deux mondes reste l'EMAIL (voir l'en-tête) : le choix
 * manuel, lui, s'exprime en identifiant de compte (`compte-a`) parce que c'est
 * ce que l'opérateur voit à l'écran et ce que le dispatch d'équipe manipule.
 * Sans cette traduction, la même préférence désignerait deux choses selon
 * l'endroit du code qui la lit.
 */
function compteIdDuConfigDir(registre: Registre, configDir: string): string | null {
  const email = emailDuConfigDir(configDir);
  if (email === null) return null;
  return registre.comptes.lister().find((c) => c.email === email)?.id ?? null;
}

/**
 * Le choix manuel, quand il s'applique.
 *
 * `☠` Hors verrou, la préférence ne vaut que pour le choix INITIAL (`depuis
 * === 0`). Une rotation demandée en cours de route signifie « ce compte vient
 * de refuser » — un fait que le registre ne connaît pas toujours encore, la
 * télémétrie ayant un temps de retard. Réappliquer la préférence là renverrait
 * l'orchestrateur sur le compte qui vient de le rejeter, et la rotation ne se
 * ferait jamais. Verrouillé, en revanche, c'est exactement ce qu'on veut :
 * l'opérateur a demandé qu'on ne bascule pas sans lui.
 */
function indexPrefereApplicable(
  configDirs: readonly string[],
  registre: Registre,
  depuis: number,
  maintenant: number,
): number | null {
  const preference = registre.comptes.lirePreference();
  if (preference.compteId === null) return null;
  if (depuis !== 0 && !preference.verrouille) return null;

  const resolution = resoudrePreference(
    configDirs,
    (dir) => compteIdDuConfigDir(registre, dir),
    preference,
    (dir) => estSature(registre, emailDuConfigDir(dir), maintenant),
  );
  if (resolution.mode === 'automatique') {
    log.info({ motif: resolution.motif }, 'préférence de compte non appliquée à l’orchestrateur');
    return null;
  }
  log.info(
    { compteId: preference.compteId, configDir: configDirs[resolution.index], verrouille: resolution.verrouille },
    resolution.verrouille
      ? 'compte orchestrateur VERROUILLÉ par l’opérateur — aucune rotation, même sur saturation'
      : 'compte orchestrateur choisi par l’opérateur',
  );
  return resolution.index;
}

export function choisirCompteDisponible(
  configDirs: readonly string[],
  registre: Registre,
  depuis = 0,
  maintenant: number = Date.now(),
): number {
  const prefere = indexPrefereApplicable(configDirs, registre, depuis, maintenant);
  if (prefere !== null) return prefere;

  for (let i = depuis; i < configDirs.length; i += 1) {
    const dir = configDirs[i];
    if (dir === undefined) continue;
    if (!estSature(registre, emailDuConfigDir(dir), maintenant)) {
      if (i !== depuis) log.info({ configDir: dir, index: i }, 'compte orchestrateur choisi sur quota mesuré');
      return i;
    }
    log.warn({ configDir: dir }, 'compte orchestrateur écarté — saturation mesurée au registre');
  }
  log.warn({}, 'tous les comptes orchestrateur sont saturés — démarrage sur le premier, le mur sera annoncé');
  return depuis;
}
