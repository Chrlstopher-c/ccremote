// Responsabilité : le parc — chaque machine, son état mesuré, ses sessions, et son alimentation (réveil, extinction).
import { Cpu, HardDrive, MemoryStick, Power, Sunrise } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useState } from 'react';
import type { VueMachine } from '../../../commun/api-clients.ts';
import { ErreurApi } from '../shared/api/client.ts';
import { useEtat, useMagasin } from '../shared/etat/contexte.tsx';
import { depuis, duree, octets } from '../shared/format.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';
import { Dialogue } from '../shared/ui/Dialogue.tsx';
import { Jauge, Point, Tag } from '../shared/ui/elements.tsx';

function Mesure({ icone, libelle, valeur, detail }: { readonly icone: ReactNode; readonly libelle: string; readonly valeur: number; readonly detail: string }): ReactNode {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[12px]">
        <span className="flex items-center gap-1.5 font-bold text-encre-douce">{icone}{libelle}</span>
        <span className="font-mono text-discret">{detail}</span>
      </div>
      <Jauge valeur={valeur} alerte={0.9} />
    </div>
  );
}

function CarteMachine({ m, sessions, reveil, surEteindre, surReveiller }: {
  readonly m: VueMachine; readonly sessions: number; readonly reveil: boolean; readonly surEteindre: () => void; readonly surReveiller: () => void;
}): ReactNode {
  const e = m.etat;
  return (
    <motion.article layout className="rounded-[var(--radius-carte)] bg-surface p-6 ombre-carte">
      <div className="mb-1 flex items-center gap-2.5">
        <Point ton={m.enLigne ? 'calme' : 'eteint'} />
        <h3 className="text-[19px] font-extrabold tracking-[-0.03em]">{m.id}</h3>
        <span className="flex-1" />
        {sessions > 0 && <Tag>{sessions} session{sessions > 1 ? 's' : ''}</Tag>}
      </div>
      <p className="mb-5 text-[13.5px] text-discret">{m.description || '—'}</p>
      {m.enLigne && e ? (
        <div className="space-y-3.5">
          <Mesure icone={<Cpu size={13} />} libelle="Processeur" valeur={e.cpu / 100} detail={`${Math.round(e.cpu)} % · charge ${e.charge.toFixed(1)}`} />
          <Mesure icone={<MemoryStick size={13} />} libelle="Mémoire" valeur={e.memoire.utilisee / e.memoire.totale} detail={`${octets(e.memoire.utilisee)} / ${octets(e.memoire.totale)}`} />
          <Mesure icone={<HardDrive size={13} />} libelle="Disque" valeur={e.disque.utilise / e.disque.total} detail={`${octets(e.disque.utilise)} / ${octets(e.disque.total)}`} />
          <p className="font-mono text-[11px] text-discret">allumée depuis {duree(e.demarreeDepuis)} · poste {m.version}</p>
        </div>
      ) : (
        <p className="rounded-[12px] bg-surface-2 px-4 py-3 text-[13px] text-discret">Hors ligne · vue {depuis(m.derniereVue)}</p>
      )}
      <div className="mt-5 flex gap-2">
        {!m.enLigne && reveil && <Bouton compact variante="plein" icone={<Sunrise size={14} />} onClick={surReveiller}>Réveiller</Bouton>}
        {m.enLigne && <Bouton compact variante="danger" icone={<Power size={14} />} onClick={surEteindre}>Éteindre</Bouton>}
      </div>
    </motion.article>
  );
}

export function VueParc(): ReactNode {
  const { client } = useMagasin();
  const machines = useEtat((e) => e.machines);
  const sessions = useEtat((e) => e.sessions);
  const reveil = useEtat((e) => e.reveilPossible);
  const [aEteindre, setAEteindre] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function agir(f: () => Promise<void>, ok: string): Promise<void> {
    try {
      await f();
      setMessage(ok);
    } catch (e) {
      setMessage(e instanceof ErreurApi ? e.message : String(e));
    }
  }

  const ouvertesSur = (id: string): number => sessions.filter((s) => s.machine === id && s.tmux !== null).length;

  return (
    <section className="h-full flex-1 overflow-y-auto bg-fond px-10 py-8">
      <div className="surtitre mb-2">Machines</div>
      <h1 className="mb-6 text-[30px] font-extrabold tracking-[-0.04em]">Le parc</h1>
      {message && <p className="mb-5 rounded-[12px] bg-accent-fond px-4 py-2.5 text-[13.5px] font-semibold text-accent-texte">{message}</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5">
        {machines.map((m) => (
          <CarteMachine key={m.id} m={m} sessions={ouvertesSur(m.id)} reveil={reveil.includes(m.id)}
            surReveiller={() => void agir(() => client.reveiller(m.id), `Réveil envoyé à ${m.id}.`)} surEteindre={() => setAEteindre(m.id)} />
        ))}
      </div>
      <Dialogue ouvert={aEteindre !== null} surFermer={() => setAEteindre(null)} titre={`Éteindre ${aEteindre ?? ''} ?`} surtitre="Alimentation" largeur={460}>
        <p className="mb-6 text-[14.5px] text-encre-douce">
          {aEteindre && ouvertesSur(aEteindre) > 0
            ? `${ouvertesSur(aEteindre)} session(s) Claude y sont encore ouvertes : elles seront coupées (reprenables ensuite).`
            : 'Aucune session Claude n’y est ouverte.'}
        </p>
        <div className="flex justify-end gap-2">
          <Bouton variante="discret" onClick={() => setAEteindre(null)}>Annuler</Bouton>
          <Bouton variante="danger" icone={<Power size={15} />} onClick={() => {
            const id = aEteindre;
            setAEteindre(null);
            if (id) void agir(() => client.eteindre(id), `Extinction demandée à ${id}.`);
          }}>Éteindre</Bouton>
        </div>
      </Dialogue>
    </section>
  );
}
