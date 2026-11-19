// Responsabilité : les demandes de confirmation de Chris — un outil (Claude) demande, l'appli répond, l'outil attend.
// Refus, silence ou relais redémarré = rien ne se fait : la demande expire (5 min) et compte comme refusée.
import { randomUUID } from 'node:crypto';
import type { MessageClient } from '../../commun/api-clients.ts';

export type StatutConfirmation = 'en_attente' | 'accordee' | 'refusee' | 'expiree';

export interface Confirmation {
  readonly id: string;
  readonly action: string;
  readonly cible: string;
  readonly resume: string;
  readonly statut: StatutConfirmation;
  readonly cree_le: string;
}

export interface DemandeConfirmation {
  readonly action: string;
  readonly cible: string;
  readonly resume: string;
}

const MAX_CONSERVEES = 200;
const PAS_MS = 250;

export class Confirmations {
  private readonly demandes = new Map<string, Confirmation & { echeance: number }>();

  constructor(
    private readonly diffuser: (m: MessageClient) => void,
    private readonly delaiMs = 5 * 60_000,
  ) {}

  demander(d: DemandeConfirmation): Confirmation {
    this.elaguer();
    const maintenant = Date.now();
    const c = {
      id: randomUUID(),
      action: d.action,
      cible: d.cible,
      resume: d.resume,
      statut: 'en_attente' as const,
      cree_le: new Date(maintenant).toISOString(),
      echeance: maintenant + this.delaiMs,
    };
    this.demandes.set(c.id, c);
    this.diffuser({ type: 'confirmation', confirmation: this.publique(c.id) });
    return this.publique(c.id);
  }

  lire(id: string): Confirmation | null {
    const c = this.demandes.get(id);
    if (!c) return null;
    if (c.statut === 'en_attente' && Date.now() >= c.echeance) this.fixer(c, 'expiree');
    return this.publique(id);
  }

  repondre(id: string, accord: boolean): { ok: true; confirmation: Confirmation } | { ok: false; erreur: string } {
    const c = this.demandes.get(id);
    if (!c) return { ok: false, erreur: 'confirmation inconnue' };
    this.lire(id);
    if (c.statut !== 'en_attente') return { ok: false, erreur: `confirmation déjà ${c.statut}` };
    this.fixer(c, accord ? 'accordee' : 'refusee');
    return { ok: true, confirmation: this.publique(id) };
  }

  /** Attend la réponse (ou l'expiration) pendant au plus `ms`. Rend l'état atteint. */
  async attendre(id: string, ms: number): Promise<Confirmation | null> {
    const fin = Date.now() + ms;
    let c = this.lire(id);
    while (c && c.statut === 'en_attente' && Date.now() < fin) {
      await Bun.sleep(PAS_MS);
      c = this.lire(id);
    }
    return c;
  }

  private fixer(c: Confirmation & { echeance: number }, statut: StatutConfirmation): void {
    this.demandes.set(c.id, { ...c, statut });
    this.diffuser({ type: 'confirmation', confirmation: this.publique(c.id) });
  }

  private publique(id: string): Confirmation {
    const { echeance: _echeance, ...publique } = this.demandes.get(id) as Confirmation & { echeance: number };
    return publique;
  }

  private elaguer(): void {
    if (this.demandes.size < MAX_CONSERVEES) return;
    for (const [id, c] of this.demandes) {
      if (c.statut !== 'en_attente') this.demandes.delete(id);
      if (this.demandes.size < MAX_CONSERVEES) return;
    }
  }
}
