// Responsabilité : l'écran d'un agent (une session Claude Code), ouvert en cliquant sur son Clawd — en-tête (projet,
// machine, modèle, contexte, état), actions (interrompre, compacter, éteindre / rallumer, archiver), fil complet,
// question en attente avec ses choix, champ d'envoi ; à droite ce que l'agent a touché.
import { useState } from 'react';

import { dureeLisible, etatAgent, type ResumeSession } from '../../donnees';
import { fermer, ouvrir } from '../bus';
import { useMonde, useMondeBrut } from '../contexte';
import { Panneau } from '../Panneau';
import { CarteDialogue } from './CarteDialogue';
import { Composeur } from './Composeur';
import { Fil } from './Fil';
import { Touches } from './Touches';
import './agent.css';

const LIBELLE: Record<string, string> = {
  bloque: 'Bloqué — t\'attend', travail: 'Au travail', fini: 'Tour fini', inactive: 'Inactif',
  eteinte: 'Éteint', erreur: 'Erreur',
};

const VIDE: readonly never[] = [];

function Actions(p: { s: ResumeSession; etat: string }) {
  const { actions } = useMondeBrut();
  const [occupe, setOccupe] = useState(false);
  const faire = (f: () => Promise<unknown>) => async () => {
    setOccupe(true);
    try {
      await f();
    } finally {
      setOccupe(false);
    }
  };
  const id = p.s.id;
  return (
    <>
      {p.etat === 'travail' ? (
        <button className="bouton-pixel" disabled={occupe} onClick={faire(() => actions.interrompre(id))}>Interrompre</button>
      ) : null}
      {p.etat !== 'eteinte' ? (
        <button className="bouton-pixel discret" disabled={occupe} onClick={faire(() => actions.compacter(id))}>Compacter</button>
      ) : null}
      <button className="bouton-pixel discret" onClick={() => ouvrir({ type: 'terminal', machine: p.s.machine, cwd: p.s.cwd,
        titre: p.s.projet.nom })}>Terminal</button>
      {p.etat === 'eteinte' ? (
        <button className="bouton-pixel primaire" disabled={occupe} onClick={faire(() => actions.reprendre(id))}>Rallumer</button>
      ) : (
        <button className="bouton-pixel danger" disabled={occupe} onClick={faire(() => actions.eteindre(id))}>Éteindre</button>
      )}
      <button className="bouton-pixel discret" disabled={occupe} onClick={faire(async () => {
        await actions.archiver(id);
        fermer();
      })}>Archiver</button>
    </>
  );
}

export function EcranAgent(p: { sessionId: string }) {
  const s = useMonde((e) => e.sessions.find((x) => x.id === p.sessionId));
  const fil = useMonde((e) => e.fil[p.sessionId] ?? VIDE);
  if (!s) {
    return (
      <Panneau titre="Session introuvable" variante="ecran">
        <div className="fil-vide">Cette session n'existe plus.</div>
      </Panneau>
    );
  }
  const etat = etatAgent(s, Date.now());
  const ctx = s.contexte.max ? Math.round((s.contexte.tokens / s.contexte.max) * 100) : 0;
  return (
    <Panneau
      variante="ecran"
      large
      titre={<><span className={`pastille ${etat}`} /> {s.titre}</>}
      sousTitre={`${s.projet.nom} · ${s.machine} · ${s.modele} · contexte ${ctx} % · ${LIBELLE[etat] ?? etat} depuis ${dureeLisible(s.majLe, Date.now())}`}
      actions={<Actions s={s} etat={etat} />}
    >
      <div className="ecran-agent">
        <div className="ecran-principal">
          <Fil fil={fil} />
          {s.dialogue ? <CarteDialogue sessionId={s.id} dialogue={s.dialogue} /> : null}
          <Composeur sessionId={s.id} actif={etat !== 'eteinte'} />
        </div>
        <Touches fil={fil} machine={s.machine} sessionId={s.id} />
      </div>
    </Panneau>
  );
}
