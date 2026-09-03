/**
 * Responsabilité : implémentation réelle de `LecteurDomainesEquipe` (D3, axe B,
 * branchement #4) — donne au Pi la liste FERMÉE des domaines de team d'un projet.
 *
 * `☠` Source que le Pi POSSÈDE DÉJÀ : le registre de fichiers de configuration
 * (`chargerProjets` sur `repertoireProjets`), le même que sert `lister_projets`.
 * Purement Pi-local — AUCUN import ni appel vers le superviseur : la frontière
 * A↔B reste nette, sans forcer un import direct control-plane ↔ superviseur.
 *
 * `☠` `null` = projet NON DÉCLARÉ (ou config illisible) : `evaluerDomaineEquipe`
 * traite alors le domaine comme accepté tel quel — un refus inventé sur une
 * config qu'on n'a pas lue serait pire qu'une validation sautée. Un tableau (même
 * vide) = liste FERMÉE : `[]` refuse TOUT domaine, une liste non vide n'accepte
 * que ses membres.
 *
 * `☠` LIMITE mesurée (point dur #4) : ce registre de fichiers est VIDE en
 * production (voir `lister_projets`) et `validerConfigProjet` vérifie `cheminDepot`
 * contre le disque DU PI — où les dépôts ne vivent pas (ils sont sur le PC). En
 * pratique le lookup rend donc `null` aujourd'hui (validation sautée, comportement
 * inchangé), mais il ENFORCE dès qu'un projet est déclaré sur le Pi.
 */

import { chargerProjets, type DependancesChargeur } from '../../projets/index.ts';
import type { LecteurDomainesEquipe } from '../../control-plane/orchestrateur/mcp-controle/outils-cycle-vie.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'lecteur-domaines-equipe' });

/**
 * Construit le lecteur de domaines. `deps` porte l'`interrogateurGit` réel en prod,
 * et permet en test d'injecter `listerFichiers`/`lireFichier` (aucune I/O réelle).
 */
export function creerLecteurDomainesEquipe(
  repertoireProjets: string,
  deps: DependancesChargeur,
): LecteurDomainesEquipe {
  return {
    domainesDe: async (projet: string): Promise<readonly string[] | null> => {
      try {
        const { projets } = await chargerProjets(repertoireProjets, deps);
        // `☠` Match par `id` OU `cheminDepot` : un mandat désigne son projet
        // tantôt par nom (l'`id` déclaré), tantôt par chemin absolu (le `cwd`).
        const trouve = projets.find((c) => c.id === projet || c.cheminDepot === projet);
        return trouve === undefined ? null : trouve.domainesEquipe;
      } catch (erreur) {
        log.warn(
          { err: erreur, projet },
          'lecture des domaines de team impossible — validation du domaine sautée (domaine accepté tel quel)',
        );
        return null;
      }
    },
  };
}
