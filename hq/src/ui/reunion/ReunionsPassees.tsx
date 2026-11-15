// Responsabilité : la liste des réunions passées de la salle — reprendre une réunion, ou en commencer une nouvelle.
import type { Reunion } from '../../donnees';

function date(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

interface Props {
  reunions: readonly Reunion[];
  courante: Reunion | null;
  selectionner: (r: Reunion | null) => void;
}

export function ReunionsPassees(p: Props) {
  return (
    <aside className="salle-passees">
      <h3 className="titre-pixel salle-titre-col">Réunions</h3>
      <button className="bouton-pixel salle-nouvelle" disabled={!p.courante} onClick={() => p.selectionner(null)}>
        + Nouvelle réunion
      </button>
      <ul className="salle-liste-passees">
        {p.reunions.map((r) => (
          <li key={r.id}>
            <button className={p.courante?.id === r.id ? 'courante' : ''} onClick={() => p.selectionner(r)}>
              <span className="salle-passee-sujet">{r.sujet}</span>
              <span className="salle-passee-meta">
                {date(r.creeLe)} · {r.participants.length} agent{r.participants.length > 1 ? 's' : ''} ·{' '}
                {r.messages.length} msg
              </span>
            </button>
          </li>
        ))}
        {p.reunions.length === 0 ? <li className="salle-vide-petit">Aucune réunion pour l'instant.</li> : null}
      </ul>
    </aside>
  );
}
