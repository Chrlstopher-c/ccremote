// Responsabilité : l'usage d'un compte vu par le SDK (abonnement, contributeurs), lu sur la première session vivante
// de ce compte qui porte une requête SDK. Le scan des contributeurs parcourt 7 jours de transcripts : le résultat est
// gardé 5 min par compte. Sans session vivante, rien n'est lu : la dernière lecture datée reste rendue (les sessions
// au repos n'ont pas de processus).
import type { Logger } from 'pino';
import type { UsageSdk } from '../../commun/compte-detail.ts';

const CACHE_MS = 5 * 60_000;

/** Les champs de la réponse SDK que ce module lit (la réponse complète du SDK les porte). */
export interface ReponseUsage {
  readonly session: unknown;
  readonly subscription_type: string | null;
  readonly behaviors: unknown;
}

/** Ce qu'il faut d'une session pour lire l'usage de son compte (une SessionPoste le satisfait). */
export interface SessionUsage {
  readonly resume: { readonly id: string; readonly compte: string | null };
  readonly vivante: boolean;
  usageSdk?(): Promise<ReponseUsage | null>;
}

interface Memo {
  readonly depuis: number;
  readonly valeur: Promise<UsageSdk | null>;
}

export class UsageComptes {
  private readonly memos = new Map<string, Memo>();
  private readonly dernieres = new Map<string, UsageSdk>(); // dernière lecture reçue, par compte

  constructor(
    private readonly sessions: () => Iterable<SessionUsage>,
    private readonly journal: Logger,
    private readonly maintenant: () => number = Date.now,
  ) {}

  lire(compte: string): Promise<UsageSdk | null> {
    const memo = this.memos.get(compte);
    if (memo && this.maintenant() - memo.depuis < CACHE_MS) return memo.valeur;
    const session = Array.from(this.sessions()).find(
      (s) => s.resume.compte === compte && s.vivante && s.usageSdk !== undefined,
    );
    if (!session) return Promise.resolve(this.dernieres.get(compte) ?? null);
    const valeur = this.interroger(session, compte);
    this.memos.set(compte, { depuis: this.maintenant(), valeur });
    return valeur;
  }

  private async interroger(s: SessionUsage, compte: string): Promise<UsageSdk | null> {
    try {
      const r = await s.usageSdk?.();
      if (!r) return null;
      const usage: UsageSdk = {
        sessionId: s.resume.id,
        session: r.session,
        abonnement: r.subscription_type,
        contributeurs: r.behaviors,
        luLe: new Date(this.maintenant()).toISOString(),
      };
      this.dernieres.set(compte, usage);
      return usage;
    } catch (erreur) {
      const motif = erreur instanceof Error ? erreur.name : 'erreur';
      this.journal.warn({ compte, session: s.resume.id, motif }, 'usage du compte non lu');
      return null;
    }
  }
}
