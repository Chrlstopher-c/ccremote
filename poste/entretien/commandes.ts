// Responsabilité : exécuter les commandes d'entretien reçues du relais (chantiers, processus, sessions tmux, réveil) et
// rendre leur réponse. Le poste lit et signale ; il ne décide de rien d'autre que ce que l'inventaire permet.
import type { Logger } from 'pino';
import { GENRES_ENTRETIEN, type TmuxPoste } from '../../commun/entretien.ts';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import { envoyerReveil } from '../../commun/reveil.ts';
import type { Reponse } from '../session/gestionnaire.ts';
import * as tmux from '../session/tmux.ts';
import { arreterProcessus, arreterTmux, type DependancesArret } from './arret.ts';
import { lireChantiers } from './chantiers.ts';
import { inventairePoste } from './inventaire.ts';
import { lireProcessus } from './proc.ts';
import { sessionsTmux } from './tmux-entretien.ts';

export type CommandeEntretien = Extract<CommandeRelais, { kind: (typeof GENRES_ENTRETIEN)[number] }>;

export interface ContexteEntretien {
  readonly machine: string;
  readonly racine: number;
  readonly lancement: string;
  readonly fichierRegistre: string;
  readonly dossierChantiers: string;
  readonly reveilFactice: string | undefined;
  readonly sessionDePid: (pid: number) => string | null;
  /** Les sessions tmux que le gestionnaire connaît (par nom). */
  readonly suivis: () => ReadonlySet<string>;
  /** Serveur tmux partagé (`claude`) : seules les sessions de ce poste comptent. */
  readonly partage: boolean;
  /** Les arrêts déjà signalés par ce poste (SIGTERM), gardés entre les commandes. */
  readonly envoyes: Set<string>;
  readonly journal: Logger;
}

export function estEntretien(c: CommandeRelais): c is CommandeEntretien {
  return (GENRES_ENTRETIEN as readonly string[]).includes(c.kind);
}

async function sessionsDuPoste(x: ContexteEntretien): Promise<TmuxPoste[]> {
  return sessionsTmux(await tmux.lister(), x.suivis(), x.partage);
}

function depsArret(x: ContexteEntretien): DependancesArret {
  return {
    inventaire: () => inventairePoste(x),
    signaler: (pid, signal) => {
      try {
        process.kill(pid, signal);
      } catch (erreur) {
        x.journal.warn({ pid, signal, err: erreur }, 'signal non envoyé');
      }
    },
    attendre: (ms) => Bun.sleep(ms),
    vivant: (pid, debut) => lireProcessus(pid, x.journal)?.debut === debut,
    proteges: new Set([x.racine, process.ppid]),
    envoyes: x.envoyes,
  };
}

/** Une commande d'entretien → sa réponse. Les gestes rendent un résultat lisible (`ResultatGeste`) dans `donnees`. */
export async function executerEntretien(c: CommandeEntretien, x: ContexteEntretien): Promise<Reponse> {
  switch (c.kind) {
    case 'chantiers':
      return { ok: true, donnees: { chantiers: lireChantiers(x.dossierChantiers, x.journal) } };
    case 'processus':
      return {
        ok: true,
        donnees: {
          processus: inventairePoste(x),
          tmux: await sessionsDuPoste(x),
        },
      };
    case 'processus_arreter':
      return { ok: true, donnees: await arreterProcessus(depsArret(x), c) };
    case 'tmux_arreter':
      return {
        ok: true,
        donnees: await arreterTmux(
          { sessions: () => sessionsDuPoste(x), tuer: (nom) => tmux.tuer(nom), journal: x.journal },
          c.nom,
        ),
      };
    case 'reveiller':
      return reveiller(c, x);
  }
}

async function reveiller(c: Extract<CommandeEntretien, { kind: 'reveiller' }>, x: ContexteEntretien): Promise<Reponse> {
  try {
    await envoyerReveil({ mac: c.mac, diffusion: c.diffusion, par: x.machine }, x.reveilFactice, x.journal);
    return { ok: true, donnees: { ok: true, par: x.machine } };
  } catch {
    return { ok: false, erreur: 'réveil impossible' };
  }
}
