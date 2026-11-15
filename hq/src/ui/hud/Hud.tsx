// Responsabilité : le HUD d'Agent HQ toujours visible au-dessus du monde — état du lien, agents qui attendent Chris
// (rouge, clignotant : urgent), questions et fins de tour (ambre), machines, boutons Nouvel agent et Réunion ;
// notifications navigateur quand un agent se bloque et que l'onglet est caché.
import { useEffect, useMemo, useRef } from 'react';

import { etatAgent, type ResumeSession } from '../../donnees';
import { ouvrir } from '../bus';
import { useMonde } from '../contexte';
import './hud.css';

const LIEN: Record<string, string> = { ouvert: 'en ligne', connexion: 'connexion…', coupe: 'coupé' };

function prevenir(bloquees: readonly ResumeSession[]): void {
  if (!('Notification' in window) || document.visibilityState === 'visible') return;
  if (Notification.permission === 'default') void Notification.requestPermission();
  if (Notification.permission !== 'granted') return;
  for (const s of bloquees) new Notification(`${s.projet.nom} t'attend`, { body: s.titre, tag: s.id });
}

function Compteur(p: { classe: string; titre: string; sessions: readonly ResumeSession[] }) {
  if (!p.sessions.length) return null;
  const premiere = p.sessions[0];
  return (
    <button className={`hud-compteur ${p.classe}`} title={p.titre}
      onClick={() => premiere && ouvrir({ type: 'agent', sessionId: premiere.id })}>
      <b>{p.sessions.length}</b> {p.titre}
    </button>
  );
}

export function Hud() {
  const sessions = useMonde((e) => e.sessions);
  const machines = useMonde((e) => e.machines);
  const lien = useMonde((e) => e.lien);
  const { bloquees, finies } = useMemo(() => {
    const t = Date.now();
    const actives = sessions.filter((s) => !s.archivee);
    return {
      bloquees: actives.filter((s) => etatAgent(s, t) === 'bloque'),
      finies: actives.filter((s) => etatAgent(s, t) === 'fini'),
    };
  }, [sessions]);
  const deja = useRef(new Set<string>());
  useEffect(() => {
    const nouvelles = bloquees.filter((s) => !deja.current.has(s.id));
    deja.current = new Set(bloquees.map((s) => s.id));
    if (nouvelles.length) prevenir(nouvelles);
  }, [bloquees]);
  return (
    <div className="hud">
      <div className="hud-gauche interactif">
        <span className="hud-logo titre-pixel">Agent HQ</span>
        <span className={`hud-lien ${lien}`}>● {LIEN[lien] ?? lien}</span>
      </div>
      <div className="hud-centre interactif">
        <Compteur classe="rouge" titre="t'attendent" sessions={bloquees} />
        <Compteur classe="ambre" titre="ont fini" sessions={finies} />
      </div>
      <div className="hud-droite interactif">
        {machines.map((m) => (
          <span key={m.id} className={`hud-machine ${m.enLigne ? 'on' : ''}`} title={m.description}>● {m.id}</span>
        ))}
        <button className="bouton-pixel" onClick={() => ouvrir({ type: 'reunion' })}>Réunion</button>
        <button className="bouton-pixel primaire" onClick={() => ouvrir({ type: 'nouvelle' })}>+ Agent</button>
      </div>
    </div>
  );
}
