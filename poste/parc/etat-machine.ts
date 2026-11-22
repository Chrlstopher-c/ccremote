// Responsabilité : mesurer l'état de la machine (CPU, mémoire, disque, charge) pour le tableau de bord.
import { statfsSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem, uptime, userInfo } from 'node:os';
import type { Logger } from 'pino';
import type { EtatMachine } from '../../commun/protocole-poste.ts';
import { lireEchange, lireReseau } from '../entretien/systeme.ts';

interface Echantillon {
  readonly actif: number;
  readonly total: number;
}

function echantillonCpu(): Echantillon {
  let actif = 0;
  let total = 0;
  for (const c of cpus()) {
    const t = c.times;
    const somme = t.user + t.nice + t.sys + t.idle + t.irq;
    total += somme;
    actif += somme - t.idle;
  }
  return { actif, total };
}

export class SondeMachine {
  private precedent = echantillonCpu();

  constructor(
    private readonly disque: string,
    private readonly journal: Logger,
  ) {}

  // Un dossier mesuré absent ou illisible ne doit jamais arrêter le poste (appel dans un minuteur) : repli sur la racine.
  private lireDisque(): EtatMachine['disque'] {
    for (const chemin of [this.disque, '/']) {
      try {
        const fs = statfsSync(chemin);
        return { utilise: (fs.blocks - fs.bfree) * fs.bsize, total: fs.blocks * fs.bsize };
      } catch (erreur) {
        this.journal.warn({ err: erreur, chemin }, 'mesure du disque impossible');
      }
    }
    return { utilise: 0, total: 0 };
  }

  mesurer(): EtatMachine {
    const courant = echantillonCpu();
    const dTotal = courant.total - this.precedent.total;
    const cpu = dTotal > 0 ? (courant.actif - this.precedent.actif) / dTotal : 0;
    this.precedent = courant;
    const disque = this.lireDisque();
    return {
      cpu: Math.round(cpu * 1000) / 10,
      memoire: { utilisee: totalmem() - freemem(), totale: totalmem() },
      disque,
      charge: loadavg()[0] ?? 0,
      demarreeDepuis: Math.round(uptime()),
      utilisateur: userInfo().username,
      echange: lireEchange(this.journal) ?? undefined,
      reseau: lireReseau(this.journal),
    };
  }
}
