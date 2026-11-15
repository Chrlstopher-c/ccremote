// Responsabilité : l'accueil du bâtiment — embaucher un agent, c'est-à-dire ouvrir une nouvelle session Claude Code :
// machine, projet, titre, premier message (obligatoire) et modèle, puis « Embaucher l'agent ».
import { useMemo, type ReactNode } from 'react';

import type { Projet } from '../../donnees';
import { Panneau } from '../Panneau';
import { ChoixMachine, ChoixModele, ChoixProjet } from './Choix';
import { useEmbauche, type Embauche } from './use-embauche';
import './nouvelle.css';

const AUCUN: readonly Projet[] = [];

function Rubrique(p: { titre: string; aide?: string; children: ReactNode; grande?: boolean }) {
  return (
    <section className={`embauche-rubrique ${p.grande ? 'grande' : ''}`}>
      <h3 className="titre-pixel">{p.titre}</h3>
      {p.aide ? <p className="embauche-aide">{p.aide}</p> : null}
      {p.children}
    </section>
  );
}

function ColonneOu(e: Embauche) {
  const projets = useMemo(
    () => e.machines.find((m) => m.id === e.machine)?.projets ?? AUCUN,
    [e.machines, e.machine],
  );
  return (
    <div className="embauche-col">
      <Rubrique titre="1. Machine" aide="Seules les machines en ligne peuvent accueillir un agent.">
        <ChoixMachine machines={e.machines} choisie={e.machine} choisir={e.choisirMachine} />
      </Rubrique>
      <Rubrique titre="2. Projet" grande>
        <ChoixProjet key={e.machine} projets={projets} choisi={e.f.projet} choisir={(x) => e.changer({ projet: x })} />
      </Rubrique>
    </div>
  );
}

function ColonneQuoi(e: Embauche) {
  return (
    <div className="embauche-col">
      <Rubrique titre="3. Mission" grande>
        <input
          className="embauche-champ"
          placeholder="Titre (facultatif, sinon tiré du message)"
          maxLength={120}
          value={e.f.titre}
          onChange={(x) => e.changer({ titre: x.target.value })}
          aria-label="Titre"
        />
        <textarea
          className="embauche-champ embauche-message"
          placeholder="Premier message à l'agent : ce qu'il doit faire…"
          value={e.f.message}
          onChange={(x) => e.changer({ message: x.target.value })}
          aria-label="Premier message"
          aria-required
        />
      </Rubrique>
      <Rubrique titre="4. Modèle">
        <ChoixModele choisi={e.f.modele} choisir={(id) => e.changer({ modele: id })} />
        <label className="embauche-autonomie">
          <input type="checkbox" checked={e.f.autonomie} onChange={(x) => e.changer({ autonomie: x.target.checked })} />
          Travaille seul jusqu'à l'objectif (sinon il t'attend à chaque tour, comme dans Desktop)
        </label>
      </Rubrique>
      <Pied e={e} />
    </div>
  );
}

function manque(e: Embauche): string {
  if (!e.machine) return 'Aucune machine en ligne.';
  if (!e.f.projet) return 'Choisis un projet.';
  if (!e.f.message.trim()) return 'Écris le premier message.';
  return '';
}

function Pied(p: { e: Embauche }) {
  const { e } = p;
  return (
    <div className="embauche-pied">
      {e.erreur ? <div className="embauche-erreur" role="alert">Embauche refusée : {e.erreur}</div> : null}
      {!e.erreur && !e.pret && !e.envoi ? <div className="embauche-manque">{manque(e)}</div> : null}
      <button className="bouton-pixel primaire embauche-bouton" disabled={!e.pret} onClick={() => void e.embaucher()}>
        {e.envoi ? 'Embauche en cours…' : "Embaucher l'agent"}
      </button>
    </div>
  );
}

export default function NouvelleSession() {
  const e = useEmbauche();
  return (
    <Panneau
      variante="bois"
      titre="Accueil — embaucher un agent"
      sousTitre="Une nouvelle session Claude Code sur une de tes machines"
    >
      <div className="embauche">
        <ColonneOu {...e} />
        <ColonneQuoi {...e} />
      </div>
    </Panneau>
  );
}
