// Responsabilité : mesurer l'état de la machine (CPU, mémoire, disque, charge) pour le tableau de bord.
import { statfsSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';
import type { EtatMachine } from '../../commun/protocole-poste.ts';

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

  constructor(private readonly disque: string) {}

  mesurer(): EtatMachine {
    const courant = echantillonCpu();
    const dTotal = courant.total - this.precedent.total;
    const cpu = dTotal > 0 ? (courant.actif - this.precedent.actif) / dTotal : 0;
    this.precedent = courant;
    const fs = statfsSync(this.disque);
    return {
      cpu: Math.round(cpu * 1000) / 10,
      memoire: { utilisee: totalmem() - freemem(), totale: totalmem() },
      disque: { utilise: (fs.blocks - fs.bfree) * fs.bsize, total: fs.blocks * fs.bsize },
      charge: loadavg()[0] ?? 0,
      demarreeDepuis: Math.round(uptime()),
    };
  }
}
