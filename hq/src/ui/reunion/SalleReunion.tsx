// Responsabilité : la salle de réunion — Chris parle à plusieurs agents à la fois autour d'une table : participants à
// gauche, fil de la réunion au centre, réunions passées à droite ; onglets sur téléphone.
import { useState } from 'react';

import { useMonde } from '../contexte';
import { Panneau } from '../Panneau';
import { EnvoiReunion, FilReunion } from './FilReunion';
import { Participants } from './Participants';
import { ReunionsPassees } from './ReunionsPassees';
import { useSalle, type Salle } from './use-salle';
import './reunion.css';

type Onglet = 'participants' | 'fil' | 'reunions';

const ONGLETS: readonly { id: Onglet; libelle: string }[] = [
  { id: 'participants', libelle: 'Participants' },
  { id: 'fil', libelle: 'Réunion' },
  { id: 'reunions', libelle: 'Historique' },
];

function Onglets(p: { onglet: Onglet; choisir: (o: Onglet) => void; nombre: number }) {
  return (
    <nav className="salle-onglets" role="tablist">
      {ONGLETS.map((o) => (
        <button key={o.id} role="tab" aria-selected={p.onglet === o.id}
          className={`bouton-pixel ${p.onglet === o.id ? 'primaire' : ''}`} onClick={() => p.choisir(o.id)}>
          {o.libelle}{o.id === 'participants' && p.nombre > 0 ? ` (${p.nombre})` : ''}
        </button>
      ))}
    </nav>
  );
}

function libelleEnvoi(s: Salle): string {
  if (s.auto) return 'Envoyer (Auto)';
  if (s.choisis.length === 0) return 'Choisis des agents';
  return `Envoyer à ${s.choisis.length} agent${s.choisis.length > 1 ? 's' : ''}`;
}

function Erreurs(p: { s: Salle }) {
  const sessions = useMonde((e) => e.sessions);
  if (!p.s.erreur && p.s.refus.length === 0) return null;
  return (
    <div className="salle-erreurs" role="alert">
      {p.s.erreur ? <div>{p.s.erreur}</div> : null}
      {p.s.refus.map((r) => (
        <div key={r.sessionId}>
          Non transmis à {sessions.find((x) => x.id === r.sessionId)?.titre ?? r.sessionId} : {r.erreur ?? 'refusé'}
        </div>
      ))}
    </div>
  );
}

function Centre(p: { s: Salle }) {
  const { s } = p;
  return (
    <main className="salle-centre">
      <div className="salle-table">
        <FilReunion reunion={s.courante} refuses={s.refus.map((r) => r.sessionId)} />
      </div>
      <Erreurs s={s} />
      <EnvoiReunion cible={libelleEnvoi(s)} possible={s.auto || s.choisis.length > 0} envoi={s.envoi}
        envoyer={s.envoyer} />
    </main>
  );
}

export default function SalleReunion() {
  const s = useSalle();
  const [onglet, setOnglet] = useState<Onglet>('fil');
  return (
    <Panneau variante="bois" large titre="Salle de réunion"
      sousTitre={s.courante ? s.courante.sujet : 'Pose une question à plusieurs agents à la fois'}>
      <div className="salle" data-onglet={onglet}>
        <Onglets onglet={onglet} choisir={setOnglet} nombre={s.auto ? 0 : s.choisis.length} />
        <Participants choisis={s.choisis} auto={s.auto} basculer={s.basculer} definirAuto={s.definirAuto} />
        <Centre s={s} />
        <ReunionsPassees reunions={s.reunions} courante={s.courante} selectionner={(r) => {
          s.selectionner(r);
          setOnglet('fil');
        }} />
      </div>
    </Panneau>
  );
}
