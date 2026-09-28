// Responsabilité : lire la réponse de l'API d'usage OAuth (`/api/oauth/usage`) en fenêtres de quota. Pur, sans I/O.
// Préfère la liste `limits` (session, semaine, plafonds propres à un modèle) ; se rabat sur `five_hour` / `seven_day`.
import type { FenetreUsage } from '../../commun/comptes.ts';

type Objet = Record<string, unknown>;

export interface Usage {
  readonly session: FenetreUsage | null;
  readonly semaine: FenetreUsage | null;
  readonly autres: FenetreUsage[];
}

const objet = (v: unknown): Objet => (typeof v === 'object' && v !== null ? (v as Objet) : {});
const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const date = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function fenetre(libelle: string, pourcent: unknown, reinitialise: unknown): FenetreUsage | null {
  const p = nombre(pourcent);
  return p === null ? null : { libelle, pourcent: p, reinitialiseLe: date(reinitialise) };
}

function libelleLimite(l: Objet): string {
  const modele = objet(objet(l['scope'])['model'])['display_name'];
  if (l['kind'] === 'session') return 'Session (5 h)';
  if (l['kind'] === 'weekly_all') return 'Semaine';
  return typeof modele === 'string' ? `Semaine · ${modele}` : String(l['kind'] ?? 'Limite');
}

export function lireUsage(brut: unknown): Usage {
  const r = objet(brut);
  const limites = Array.isArray(r['limits']) ? r['limits'].map(objet) : [];
  if (limites.length > 0) {
    const fen = (l: Objet): FenetreUsage | null => fenetre(libelleLimite(l), l['percent'], l['resets_at']);
    const de = (kind: string): FenetreUsage | null => {
      const l = limites.find((x) => x['kind'] === kind);
      return l ? fen(l) : null;
    };
    const autres = limites.filter((l) => l['kind'] !== 'session' && l['kind'] !== 'weekly_all').map(fen);
    return {
      session: de('session'),
      semaine: de('weekly_all'),
      autres: autres.filter((f): f is FenetreUsage => f !== null),
    };
  }
  const cinq = objet(r['five_hour']);
  const sept = objet(r['seven_day']);
  return {
    session: fenetre('Session (5 h)', cinq['utilization'], cinq['resets_at']),
    semaine: fenetre('Semaine', sept['utilization'], sept['resets_at']),
    autres: [],
  };
}
