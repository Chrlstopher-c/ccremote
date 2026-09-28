// Responsabilité : la vue d'ensemble des comptes Claude Code — un compte (email) et ses installations sur les machines.
// L'usage appartient au compte, pas à la machine : on garde le relevé lisible le plus récent parmi ses installations.
import type { VueMachine } from '../../../commun/api-clients.ts';
import type { EtatCompte } from '../../../commun/comptes.ts';

export interface Installation {
  readonly machine: string;
  readonly enLigne: boolean;
  readonly etat: EtatCompte;
}

export interface CompteClaude {
  readonly cle: string;
  readonly email: string | null;
  readonly organisation: string | null;
  readonly abonnement: string | null;
  readonly usage: EtatCompte | null; // le relevé d'usage retenu (session, semaine, autres)
  readonly installations: Installation[];
}

export interface ConnexionEnCours {
  readonly machine: string;
  readonly nom: string;
  readonly url: string;
  readonly depuis: string;
}

const aUsage = (e: EtatCompte): boolean => e.session !== null || e.semaine !== null;

function plusRecent(a: EtatCompte | null, b: EtatCompte): EtatCompte {
  if (!aUsage(b)) return a ?? b;
  if (!a || !aUsage(a)) return b;
  return b.releveLe > a.releveLe ? b : a;
}

export function regrouper(machines: readonly VueMachine[]): CompteClaude[] {
  const parCle = new Map<string, { base: EtatCompte; usage: EtatCompte | null; installations: Installation[] }>();
  for (const m of machines) {
    for (const e of m.etatComptes ?? []) {
      if (e.connexion && !e.connecte) continue; // connexion en cours : listée à part
      const cle = e.email ?? `${m.id}/${e.id}`;
      const g = parCle.get(cle) ?? { base: e, usage: null, installations: [] };
      g.installations.push({ machine: m.id, enLigne: m.enLigne, etat: e });
      g.usage = aUsage(e) || g.usage === null ? plusRecent(g.usage, e) : g.usage;
      if (!g.base.abonnement && e.abonnement) g.base = e;
      parCle.set(cle, g);
    }
  }
  return [...parCle.entries()]
    .map(([cle, g]) => ({
      cle,
      email: g.base.email,
      organisation: g.base.organisation,
      abonnement: g.base.abonnement,
      usage: g.usage && aUsage(g.usage) ? g.usage : null,
      installations: g.installations.toSorted((a, b) => a.machine.localeCompare(b.machine)),
    }))
    .toSorted((a, b) => (a.email ?? '~').localeCompare(b.email ?? '~'));
}

export function connexionsEnCours(machines: readonly VueMachine[]): ConnexionEnCours[] {
  return machines.flatMap((m) =>
    (m.etatComptes ?? []).flatMap((e) =>
      e.connexion && !e.connecte
        ? [{ machine: m.id, nom: e.id, url: e.connexion.url, depuis: e.connexion.depuis }]
        : [],
    ),
  );
}

/** Un nom de compte libre sur la machine, tiré de l'email (« chris » pour chris@…), sinon « compte-2 »… */
export function nomPropose(machine: VueMachine | undefined, email: string | null): string {
  const pris = new Set((machine?.etatComptes ?? []).map((e) => e.id).concat(machine?.comptes ?? []));
  const local = (email?.split('@')[0] ?? 'compte').toLowerCase();
  const base = local.replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').slice(0, 24) || 'compte';
  if (!pris.has(base)) return base;
  for (let n = 2; ; n++) if (!pris.has(`${base}-${n}`)) return `${base}-${n}`;
}
