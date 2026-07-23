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
function estSature(registre: Registre, email: string | null): boolean {
  if (email === null) return false;
  const compte = registre.comptes.lister().find((c) => c.email === email);
  if (compte === undefined) return false;
  return registre.comptes.listerQuotas(compte.id).some((q) => q.statut === 'rejected');
}

/**
 * Index du premier compte que le registre ne tient pas pour saturé, en partant
 * de `depuis`. Rend `depuis` quand tous le sont : on ne prétend pas avoir trouvé
 * mieux, l'appelant heurtera le mur et le dira — c'est plus honnête qu'un choix
 * arbitraire présenté comme une solution.
 */
export function choisirCompteDisponible(
  configDirs: readonly string[],
  registre: Registre,
  depuis = 0,
): number {
  for (let i = depuis; i < configDirs.length; i += 1) {
    const dir = configDirs[i];
    if (dir === undefined) continue;
    if (!estSature(registre, emailDuConfigDir(dir))) {
      if (i !== depuis) log.info({ configDir: dir, index: i }, 'compte orchestrateur choisi sur quota mesuré');
      return i;
    }
    log.warn({ configDir: dir }, 'compte orchestrateur écarté — saturation mesurée au registre');
  }
  log.warn({}, 'tous les comptes orchestrateur sont saturés — démarrage sur le premier, le mur sera annoncé');
  return depuis;
}
