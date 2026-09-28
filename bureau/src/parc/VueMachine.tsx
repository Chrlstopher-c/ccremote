// Responsabilité : une machine du parc — état mesuré (tableau), projets, alimentation (réveil, extinction).
import { Power, Sunrise } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { VueMachine as Machine } from '../../../commun/api-clients.ts';
import { ErreurApi } from '../shared/api/client.ts';
import { useEtat, useMagasin } from '../shared/etat/contexte.tsx';
import { depuis, duree, octets } from '../shared/format.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';
import { Dialogue } from '../shared/ui/Dialogue.tsx';
import { Jauge, Point } from '../shared/ui/elements.tsx';

function Mesures({ m }: { readonly m: Machine }): ReactNode {
  const e = m.etat;
  if (!m.enLigne || !e) return <p className="text-[12.5px] text-discret">Hors ligne · vue {depuis(m.derniereVue)}</p>;
  const lignes: [string, number, string][] = [
    ['processeur', e.cpu / 100, `${Math.round(e.cpu)} % · charge ${e.charge.toFixed(1)}`],
    ['mémoire', e.memoire.utilisee / e.memoire.totale, `${octets(e.memoire.utilisee)} / ${octets(e.memoire.totale)}`],
    ['disque', e.disque.utilise / e.disque.total, `${octets(e.disque.utilise)} / ${octets(e.disque.total)}`],
  ];
  return (
    <table className="w-full max-w-[560px] font-mono text-[11.5px]">
      <tbody>
        {lignes.map(([nom, v, detail]) => (
          <tr key={nom} className="border-b border-filet">
            <td className="w-28 py-1.5 text-discret">{nom}</td>
            <td className="w-40 py-1.5"><Jauge valeur={v} alerte={0.9} largeur="w-32" /></td>
            <td className="py-1.5 text-encre-2">{detail}</td>
          </tr>
        ))}
        <tr>
          <td className="py-1.5 text-discret">allumée depuis</td>
          <td colSpan={2} className="py-1.5">{duree(e.demarreeDepuis)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function useAlimentation(id: string) {
  const { client } = useMagasin();
  const [message, setMessage] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState(false);
  async function agir(f: () => Promise<void>, ok: string): Promise<void> {
    try {
      await f();
      setMessage(ok);
    } catch (e) {
      setMessage(e instanceof ErreurApi ? e.message : String(e));
    }
  }
  return {
    message, confirmer, setConfirmer,
    reveiller: () => void agir(() => client.reveiller(id), 'Réveil envoyé.'),
    eteindre: () => void agir(() => client.eteindre(id), 'Extinction demandée.'),
  };
}

type Alimentation = ReturnType<typeof useAlimentation>;

function ConfirmerExtinction({ m, alim }: { readonly m: Machine; readonly alim: Alimentation }): ReactNode {
  const ouvertes = useEtat((e) => e.sessions.filter((s) => s.machine === m.id && s.tmux !== null).length);
  return (
    <Dialogue ouvert={alim.confirmer} surFermer={() => alim.setConfirmer(false)} titre={`Éteindre ${m.id} ?`}
      largeur={420}>
      <p className="mb-4 text-[13px] text-encre-2">
        {ouvertes > 0 ? `${ouvertes} session(s) Claude y sont ouvertes : elles seront coupées (reprenables).`
          : 'Aucune session Claude n’y est ouverte.'}
      </p>
      <div className="flex justify-end gap-2">
        <Bouton onClick={() => alim.setConfirmer(false)}>Annuler</Bouton>
        <Bouton ton="accent" onClick={() => { alim.setConfirmer(false); alim.eteindre(); }}>Éteindre</Bouton>
      </div>
    </Dialogue>
  );
}

export function VueMachine({ m }: { readonly m: Machine }): ReactNode {
  const peutReveiller = useEtat((e) => e.reveilPossible.includes(m.id));
  const alim = useAlimentation(m.id);
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-fond">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-filet px-4">
        <Point ton={m.enLigne ? 'calme' : 'eteint'} />
        <h1 className="flex-1 text-[13.5px] font-bold">{m.id}</h1>
        {!m.enLigne && peutReveiller && (
          <Bouton icone={<Sunrise size={13} />} onClick={alim.reveiller}>Réveiller</Bouton>
        )}
        {m.enLigne && (
          <Bouton ton="danger" icone={<Power size={13} />} onClick={() => alim.setConfirmer(true)}>Éteindre</Bouton>
        )}
      </header>
      <div className="selectionnable min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <p className="mb-4 text-[13px] text-encre-2">{m.description}</p>
        {alim.message && <p className="mb-3 font-mono text-[11.5px] text-accent-texte">{alim.message}</p>}
        <Mesures m={m} />
        <div className="etiquette mt-6 mb-1.5">{`projets · ${m.projets.length}`}</div>
        <div className="columns-2 gap-6 font-mono text-[11.5px] text-encre-2">
          {m.projets.map((p) => <div key={p.chemin} className="truncate py-0.5" title={p.chemin}>{p.nom}</div>)}
        </div>
      </div>
      <ConfirmerExtinction m={m} alim={alim} />
    </section>
  );
}
