// Responsabilité : les appels d'outils de modules venus des agents — le relais diffuse l'appel aux applis connectées,
// la première réponse utile gagne (une appli sans le module répond « module absent » : on attend les autres), et le
// délai est borné. Le relais ne connaît pas les outils : il relaie, l'appli exécute.
import { randomUUID } from 'node:crypto';
import {
  depasseTailleDonnees,
  type DemandeAppelModule,
  type ManifesteModule,
  type ReponseAppelModule,
} from '../../commun/modules.ts';
import type { MessageClient } from '../../commun/api-clients.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Registre } from '../registre/registre.ts';

export const DELAI_APPEL_MODULE_MS = 30_000;
export const MODULE_ABSENT = 'module absent';
export const AUCUNE_APPLI = "Lanterne n'est ouverte sur aucun appareil";

export interface CapaciteModule {
  readonly module: string;
  readonly nom: string;
  readonly outils: NonNullable<ManifesteModule['outils']>;
  readonly integrations: NonNullable<ManifesteModule['integrations']>;
}

export type ResultatAppel =
  | { readonly ok: true; readonly resultat: unknown }
  | { readonly ok: false; readonly erreur: string };

export interface ParametresAppels {
  readonly registre: Pick<Registre, 'modules'>;
  readonly diffusion: Pick<Diffusion, 'diffuser' | 'nombreApplis'>;
  readonly delaiMs?: number;
}

interface AttenteAppel {
  readonly module: string;
  readonly applis: number;
  absentes: number;
  readonly resoudre: (r: ResultatAppel) => void;
}

// La réponse d'une appli, rendue en résultat : un échec reste un échec lisible, un résultat trop gros est refusé.
function resultatDe(reponse: ReponseAppelModule): ResultatAppel {
  if (!reponse.ok) return { ok: false, erreur: reponse.erreur ?? 'échec de l’outil' };
  if (depasseTailleDonnees(reponse.resultat ?? null)) {
    return { ok: false, erreur: 'résultat trop volumineux (64 Ko au plus)' };
  }
  return { ok: true, resultat: reponse.resultat ?? null };
}

export class AppelsModules {
  private readonly attentes = new Map<string, AttenteAppel>();

  constructor(private readonly p: ParametresAppels) {}

  /** Outils et intégrations des modules sains, tels que déclarés par leur manifeste. */
  capacites(): CapaciteModule[] {
    return this.p.registre.modules
      .lister()
      .filter((m) => m.erreur === null && m.manifeste !== null)
      .map((m) => ({
        module: m.id,
        nom: m.manifeste?.nom ?? m.id,
        outils: m.manifeste?.outils ?? [],
        integrations: m.manifeste?.integrations ?? [],
      }));
  }

  /** Relaie l'appel aux applis connectées et rend le résultat de la première qui le réussit (ou échoue). */
  appeler(demande: DemandeAppelModule): Promise<ResultatAppel> {
    if (this.p.diffusion.nombreApplis === 0) return Promise.resolve({ ok: false, erreur: AUCUNE_APPLI });
    if (depasseTailleDonnees(demande.arguments ?? {})) {
      return Promise.resolve({ ok: false, erreur: 'arguments trop volumineux (64 Ko au plus)' });
    }
    const appel = randomUUID();
    return new Promise((resoudre) => {
      const minuteur = setTimeout(() => {
        this.attentes.delete(appel);
        resoudre({ ok: false, erreur: `le module « ${demande.module} » n'a pas répondu à temps` });
      }, this.p.delaiMs ?? DELAI_APPEL_MODULE_MS);
      this.attentes.set(appel, {
        module: demande.module,
        applis: this.p.diffusion.nombreApplis,
        absentes: 0,
        resoudre: (r) => {
          clearTimeout(minuteur);
          this.attentes.delete(appel);
          resoudre(r);
        },
      });
      const message: MessageClient = {
        type: 'module_appel',
        appel,
        module: demande.module,
        outil: demande.outil,
        arguments: demande.arguments ?? {},
        session: demande.session,
      };
      this.p.diffusion.diffuser(message);
    });
  }

  /** Réponse d'une appli. Rend faux si l'appel est inconnu ou déjà tranché (délai échu, autre appli plus rapide). */
  repondre(reponse: ReponseAppelModule): boolean {
    const attente = this.attentes.get(reponse.appel);
    if (!attente) return false;
    if (!reponse.ok && reponse.erreur === MODULE_ABSENT) {
      attente.absentes += 1;
      if (attente.absentes >= attente.applis) {
        attente.resoudre({ ok: false, erreur: `module « ${attente.module} » absent de toutes les applis ouvertes` });
      }
      return true;
    }
    attente.resoudre(resultatDe(reponse));
    return true;
  }
}
