// Responsabilité : la vue d'ensemble des comptes Claude Code du parc — usage de chacun, machines où il est connecté,
// connexions en cours ; ajouter un compte, l'ajouter à une autre machine, le retirer.
import { KeyRound, Plus, RefreshCw } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { ErreurApi } from '../shared/api/client.ts';
import { useEtat, useMagasin } from '../shared/etat/contexte.tsx';
import { depuis } from '../shared/format.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';
import { CarteCompte } from './CarteCompte.tsx';
import { DialogueAjoutCompte, type Intention } from './DialogueAjoutCompte.tsx';
import { type ConnexionEnCours, connexionsEnCours, type Installation, regrouper } from './regroupement.ts';

function useActionsComptes() {
  const { client } = useMagasin();
  const machines = useEtat((e) => e.machines);
  const [erreur, setErreur] = useState<string | null>(null);
  const [releve, setReleve] = useState(false);
  const attraper = (e: unknown): void => setErreur(e instanceof ErreurApi ? e.message : String(e));
  return {
    erreur,
    releve,
    effacer: () => setErreur(null),
    relever: async (): Promise<void> => {
      setReleve(true);
      setErreur(null);
      await Promise.all(machines.filter((m) => m.enLigne).map((m) => client.releverComptes(m.id).catch(attraper)));
      setReleve(false);
    },
    retirer: (i: Installation): void => {
      setErreur(null);
      client.retirerCompte(i.machine, i.etat.id).catch(attraper);
    },
  };
}

function EnTete({ a, ajouter }: {
  readonly a: ReturnType<typeof useActionsComptes>;
  readonly ajouter: () => void;
}): ReactNode {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-filet px-5">
      <h1 className="flex-1 text-[13.5px] font-bold">Comptes Claude Code</h1>
      <Bouton icone={<RefreshCw size={13} className={a.releve ? 'animate-spin' : ''} />} disabled={a.releve}
        onClick={() => void a.relever()}>Relever</Bouton>
      <Bouton ton="accent" icone={<Plus size={13} />} onClick={ajouter}>Ajouter un compte</Bouton>
    </header>
  );
}

function BandeauConnexion({ c, reprendre }: {
  readonly c: ConnexionEnCours;
  readonly reprendre: () => void;
}): ReactNode {
  return (
    <div className="flex items-center gap-3 border-b border-filet bg-accent-fond px-5 py-2.5 text-[12.5px]">
      <KeyRound size={14} className="text-accent-texte" />
      <span className="flex-1">{`Connexion de « ${c.nom} » en cours sur ${c.machine} (${depuis(c.depuis)})`}</span>
      <Bouton onClick={reprendre}>Coller le code</Bouton>
    </div>
  );
}

export function VueComptes(): ReactNode {
  const machines = useEtat((e) => e.machines);
  const comptes = useMemo(() => regrouper(machines), [machines]);
  const enCours = useMemo(() => connexionsEnCours(machines), [machines]);
  const [intention, setIntention] = useState<Intention | null>(null);
  const a = useActionsComptes();
  const enLigne = machines.some((m) => m.enLigne);
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-fond">
      <EnTete a={a} ajouter={() => setIntention({ email: null, machine: null })} />
      {a.erreur && (
        <button type="button" onClick={a.effacer}
          className="cursor-default border-b border-filet px-5 py-1.5 text-left text-[12px] text-danger">
          {a.erreur}
        </button>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {enCours.map((c) => (
          <BandeauConnexion key={`${c.machine}/${c.nom}`} c={c}
            reprendre={() => setIntention({ email: null, machine: c.machine, reprise: { ...c, compte: c.nom } })} />
        ))}
        {comptes.map((c) => (
          <CarteCompte key={c.cle} c={c} peutAjouter={enLigne} retirer={a.retirer}
            ajouter={(x) => setIntention({ email: x.email, machine: null })} />
        ))}
        {comptes.length === 0 && <p className="p-6 text-[12.5px] text-discret">Aucun compte relevé pour l’instant.</p>}
      </div>
      <DialogueAjoutCompte intention={intention} surFermer={() => setIntention(null)} />
    </section>
  );
}
