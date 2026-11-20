// Responsabilité : les sessions tmux vues par l'entretien. Sur le serveur propre au poste, toutes ses sessions.
// Sur le serveur partagé (`claude`, poste non intégré), seulement celles dont une fiche a été créée par ce poste. Pur.
import type { TmuxPoste } from '../../commun/entretien.ts';
import type { PaneTmux } from '../session/tmux.ts';

/** `connues` : les noms de session que le gestionnaire connaît (fiches). Une session non suivie est un reste. */
export function sessionsTmux(panes: readonly PaneTmux[], connues: ReadonlySet<string>, partage: boolean): TmuxPoste[] {
  const visibles = partage ? panes.filter((p) => connues.has(p.nom)) : panes;
  return visibles.map((p) => ({
    nom: p.nom,
    session: null,
    depuis: p.creeLe > 0 ? new Date(p.creeLe * 1000).toISOString() : null,
    reste: !connues.has(p.nom),
  }));
}
