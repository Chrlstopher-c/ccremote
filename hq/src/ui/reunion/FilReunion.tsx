// Responsabilité : le fil de la réunion courante — demandes de Chris et réponses des agents (auteur attribué avec la
// pastille de son état), agents encore attendus, puis le champ d'envoi et le rappel des garde-fous.
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { etatAgent, type ResumeSession } from '../../donnees';
import { AUTEUR_CHRIS, type MessageReunion, type Reunion } from '../../donnees/reunion';
import { useMonde } from '../contexte';

type Annuaire = ReadonlyMap<string, ResumeSession>;

function useAnnuaire(): Annuaire {
  const sessions = useMonde((e) => e.sessions);
  return useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
}

function heure(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function nomDe(id: string, annuaire: Annuaire): string {
  return annuaire.get(id)?.titre ?? id;
}

function Auteur(p: { id: string; annuaire: Annuaire }) {
  const s = p.annuaire.get(p.id);
  const etat = s ? etatAgent(s, Date.now()) : 'eteinte';
  return (
    <div className="salle-auteur">
      <span className={`salle-pastille ${etat}`} title={s ? etat : 'session inconnue'} />
      <strong>{s?.titre ?? p.id}</strong>
      {s ? <span className="salle-auteur-lieu">{s.projet.nom} · {s.machine}</span> : null}
    </div>
  );
}

function Message(p: { m: MessageReunion; annuaire: Annuaire }) {
  if (p.m.auteur === AUTEUR_CHRIS) {
    const pour = p.m.destinataires.map((d) => nomDe(d, p.annuaire)).join(', ');
    return (
      <div className="salle-msg chris">
        <div className="salle-msg-tete"><strong>Chris</strong>{pour ? <span> → {pour}</span> : null}</div>
        <div className="salle-msg-texte">{p.m.texte}</div>
        <time>{heure(p.m.ts)}</time>
      </div>
    );
  }
  return (
    <div className="salle-msg agent">
      <Auteur id={p.m.auteur} annuaire={p.annuaire} />
      <div className="salle-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{p.m.texte}</ReactMarkdown></div>
      <time>{heure(p.m.ts)}</time>
    </div>
  );
}

// Destinataires de la dernière demande de Chris qui n'ont pas encore répondu après elle.
function attendus(r: Reunion, refuses: readonly string[]): readonly string[] {
  const i = r.messages.map((m) => m.auteur).lastIndexOf(AUTEUR_CHRIS);
  if (i < 0) return [];
  const repondu = new Set(r.messages.slice(i + 1).map((m) => m.auteur));
  return (r.messages[i]?.destinataires ?? []).filter((d) => !repondu.has(d) && !refuses.includes(d));
}

export function FilReunion(p: { reunion: Reunion | null; refuses: readonly string[] }) {
  const annuaire = useAnnuaire();
  const bas = useRef<HTMLDivElement>(null);
  const n = p.reunion?.messages.length ?? 0;
  useEffect(() => bas.current?.scrollIntoView({ block: 'end' }), [n]);
  if (!p.reunion || n === 0) {
    return (
      <div className="salle-fil salle-fil-vide">
        <p className="titre-pixel">La table est libre.</p>
        <p>Coche les agents à inviter (ou laisse le relais choisir avec « Auto »), puis pose ta question.</p>
      </div>
    );
  }
  const enAttente = attendus(p.reunion, p.refuses);
  return (
    <div className="salle-fil defile">
      {p.reunion.messages.map((m) => <Message key={m.id} m={m} annuaire={annuaire} />)}
      {enAttente.length > 0 ? (
        <div className="salle-attente">
          {enAttente.map((d) => nomDe(d, annuaire)).join(', ')} réfléchi{enAttente.length > 1 ? 'ssent' : 't'}…
        </div>
      ) : null}
      <div ref={bas} />
    </div>
  );
}

let brouillon = '';

interface PropsEnvoi {
  cible: string;
  possible: boolean;
  envoi: boolean;
  envoyer: (texte: string) => Promise<boolean>;
}

export function EnvoiReunion(p: PropsEnvoi) {
  const [texte, setTexte] = useState(brouillon);
  const changer = (t: string): void => {
    brouillon = t;
    setTexte(t);
  };
  const partir = async (): Promise<void> => {
    if (await p.envoyer(texte)) changer('');
  };
  const actif = p.possible && !p.envoi && texte.trim() !== '';
  return (
    <div className="salle-envoi">
      <div className="salle-envoi-boite">
        <textarea value={texte} rows={2}
          placeholder="Ta question à la table… (Entrée envoie, Maj+Entrée pour une ligne)"
          onChange={(e) => changer(e.target.value)} aria-label="Message à la réunion"
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            e.preventDefault();
            if (actif) void partir();
          }} />
        <button className="bouton-pixel primaire" disabled={!actif} onClick={() => void partir()}>
          {p.envoi ? '…' : p.cible}
        </button>
      </div>
      <p className="salle-garde-fous">
        Garde-fous : nombre de demandes limité par réunion, chaque agent répond une fois par demande, et toute action
        offensive attend ta validation.
      </p>
    </div>
  );
}
