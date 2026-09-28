// Responsabilité : connecter un compte Claude Code sur une machine — choisir la machine et un nom, se connecter dans
// le navigateur, coller le code. L'identifiant ne quitte jamais la machine choisie ; seul le code transite.
import { ExternalLink, KeyRound } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useEtat } from '../shared/etat/contexte.tsx';
import { ouvrirLien } from '../shared/natif.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';
import { Dialogue } from '../shared/ui/Dialogue.tsx';
import { Champ, Choix, Libelle } from '../shared/ui/elements.tsx';
import { nomPropose } from './regroupement.ts';
import { useConnexionCompte } from './useConnexionCompte.ts';

export interface Intention {
  readonly email: string | null; // compte déjà connu ailleurs : la page de connexion le pré-remplit
  readonly machine: string | null;
  readonly reprise?: { readonly machine: string; readonly compte: string; readonly url: string };
}

type Connexion = ReturnType<typeof useConnexionCompte>;

function Emplacement(p: {
  readonly machines: readonly string[];
  readonly machine: string;
  readonly setMachine: (m: string) => void;
  readonly nom: string;
  readonly setNom: (n: string) => void;
}): ReactNode {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label>
        <Libelle>Machine</Libelle>
        <Choix value={p.machine} onChange={(e) => p.setMachine(e.target.value)}>
          {p.machines.map((m) => <option key={m} value={m}>{m}</option>)}
        </Choix>
      </label>
      <label>
        <Libelle detail="minuscules, chiffres, tirets">Nom sur la machine</Libelle>
        <Champ value={p.nom} onChange={(e) => p.setNom(e.target.value)} pattern="[a-z0-9][a-z0-9-]{0,30}" required />
      </label>
    </div>
  );
}

function Formulaire({ c, intention }: { readonly c: Connexion; readonly intention: Intention }): ReactNode {
  const toutes = useEtat((e) => e.machines);
  const machines = useMemo(() => toutes.filter((m) => m.enLigne), [toutes]);
  const [machine, setMachine] = useState(intention.machine ?? machines[0]?.id ?? '');
  const vue = machines.find((m) => m.id === machine);
  const [nom, setNom] = useState(() => nomPropose(vue, intention.email));
  useEffect(() => setNom(nomPropose(vue, intention.email)), [vue, intention.email]);
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => {
      e.preventDefault();
      void c.demarrer(machine, nom, intention.email ?? undefined);
    }}>
      <Emplacement machines={machines.map((m) => m.id)} machine={machine} setMachine={setMachine} nom={nom}
        setNom={setNom} />
      <p className="text-[12px] text-discret">
        {intention.email
          ? `La page de connexion s’ouvre dans ton navigateur, avec ${intention.email} déjà rempli.`
          : 'La page de connexion Claude s’ouvre dans ton navigateur : connecte-toi avec le compte à ajouter.'}
      </p>
      <div className="flex justify-end">
        <Bouton ton="accent" type="submit" disabled={c.occupe || !machine || !nom}>
          {c.occupe ? 'Ouverture…' : 'Se connecter'}
        </Bouton>
      </div>
    </form>
  );
}

function SaisieCode({ c, url }: { readonly c: Connexion; readonly url: string }): ReactNode {
  const [code, setCode] = useState('');
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => {
      e.preventDefault();
      void c.valider(code);
    }}>
      <p className="text-[12.5px] text-encre-2">
        Une fois connecté, la page affiche un code d’autorisation. Copie-le en entier et colle-le ici.
      </p>
      <label>
        <Libelle>Code</Libelle>
        <Champ value={code} onChange={(e) => setCode(e.target.value)} autoFocus placeholder="Code rendu par la page"
          className="font-mono" required />
      </label>
      <div className="flex items-center justify-between">
        <Bouton icone={<ExternalLink size={13} />} onClick={() => void ouvrirLien(url)}>Rouvrir la page</Bouton>
        <span className="flex gap-2">
          <Bouton onClick={() => void c.abandonner()} disabled={c.occupe}>Abandonner</Bouton>
          <Bouton ton="accent" type="submit" disabled={c.occupe || !code.trim()}>
            {c.occupe ? 'Vérification…' : 'Valider'}
          </Bouton>
        </span>
      </div>
    </form>
  );
}

export function DialogueAjoutCompte({ intention, surFermer }: {
  readonly intention: Intention | null;
  readonly surFermer: () => void;
}): ReactNode {
  const c = useConnexionCompte();
  const { reprendre, reinitialiser } = c;
  useEffect(() => {
    if (intention?.reprise) reprendre(intention.reprise.machine, intention.reprise.compte, intention.reprise.url);
    else if (intention) reinitialiser();
  }, [intention]); // une fois par ouverture du dialogue
  const e = c.etape;
  return (
    <Dialogue ouvert={intention !== null} surFermer={surFermer} titre="Ajouter un compte Claude Code">
      {intention && e.nom === 'formulaire' && <Formulaire c={c} intention={intention} />}
      {e.nom === 'code' && <SaisieCode c={c} url={e.url} />}
      {e.nom === 'fini' && (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[13px] text-encre">
            <KeyRound size={14} className="text-succes" />
            {`Compte « ${e.compte} » connecté sur ${e.machine}. Son usage s’affiche dans un instant.`}
          </p>
          <div className="flex justify-end"><Bouton ton="accent" onClick={surFermer}>Terminé</Bouton></div>
        </div>
      )}
      {c.erreur && <p className="mt-3 text-[12px] text-danger">{c.erreur}</p>}
    </Dialogue>
  );
}
