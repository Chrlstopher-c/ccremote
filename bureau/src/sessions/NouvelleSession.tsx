// Responsabilité : ouvrir une session — où elle tourne, sur quel projet (de n'importe quelle machine joignable), avec quel objectif.
import { Rocket } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Projet } from '../../../commun/session.ts';
import { ErreurApi } from '../shared/api/client.ts';
import { useEtat, useMagasin } from '../shared/etat/contexte.tsx';
import { Bouton } from '../shared/ui/Bouton.tsx';
import { Dialogue } from '../shared/ui/Dialogue.tsx';
import { Bascule, Champ, Choix, Libelle, Zone } from '../shared/ui/elements.tsx';

const ISOLEE = 'vps'; // règle du parc : le VPS ne travaille que sur ses propres projets
const MODELES = [['', 'Par défaut (réglages de Claude Code)'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']] as const;

export function NouvelleSession({ ouvert, surFermer, surOuverte }: {
  readonly ouvert: boolean; readonly surFermer: () => void; readonly surOuverte: (id: string) => void;
}): ReactNode {
  const { client } = useMagasin();
  const machines = useEtat((e) => e.machines);
  const enLigne = machines.filter((m) => m.enLigne);
  const [machine, setMachine] = useState('');
  const [cleProjet, setCleProjet] = useState('');
  const [f, setF] = useState({ titre: '', objectif: '', message: '', modele: '', autonomie: true });
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (ouvert && !enLigne.some((m) => m.id === machine)) setMachine(enLigne[0]?.id ?? '');
  }, [ouvert, enLigne, machine]);

  const projets = useMemo(() => machines
    .filter((m) => (machine === ISOLEE ? m.id === ISOLEE : true))
    .map((m) => [m.id, m.projets] as const), [machines, machine]);
  const projet: Projet | undefined = projets.flatMap(([, p]) => p).find((p) => `${p.machine}:${p.chemin}` === cleProjet);

  useEffect(() => {
    const locaux = projets.find(([id]) => id === machine)?.[1] ?? [];
    if (!projet && locaux[0]) setCleProjet(`${locaux[0].machine}:${locaux[0].chemin}`);
  }, [projets, machine, projet]);

  async function soumettre(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!projet) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const s = await client.ouvrir({ machine, projet, message: f.message, titre: f.titre || undefined, objectif: f.objectif.trim() || null,
        autonomie: f.autonomie, ...(f.modele ? { modele: f.modele } : {}) });
      setF({ titre: '', objectif: '', message: '', modele: '', autonomie: true });
      surOuverte(s.id);
    } catch (err) {
      setErreur(err instanceof ErreurApi ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Dialogue ouvert={ouvert} surFermer={surFermer} titre="Nouvelle session" surtitre="Claude Code" largeur={620}>
      <form onSubmit={(e) => void soumettre(e)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label><Libelle>Machine</Libelle>
            <Choix value={machine} onChange={(e) => { setMachine(e.target.value); setCleProjet(''); }}>
              {enLigne.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
            </Choix>
          </label>
          <label><Libelle>Modèle</Libelle>
            <Choix value={f.modele} onChange={(e) => setF({ ...f, modele: e.target.value })}>
              {MODELES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Choix>
          </label>
        </div>
        <label className="block"><Libelle detail={projet && projet.machine !== machine ? `via ssh ${projet.machine}` : undefined}>Projet</Libelle>
          <Choix value={cleProjet} onChange={(e) => setCleProjet(e.target.value)} required>
            {projets.map(([id, liste]) => (
              <optgroup key={id} label={id}>{liste.map((p) => <option key={p.chemin} value={`${p.machine}:${p.chemin}`}>{p.nom}</option>)}</optgroup>
            ))}
          </Choix>
        </label>
        <label className="block"><Libelle detail="facultatif">Titre</Libelle>
          <Champ value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} placeholder="Déduit du premier message" />
        </label>
        <label className="block"><Libelle detail="la session travaille jusqu’à l’atteindre">Objectif</Libelle>
          <Zone rows={2} value={f.objectif} onChange={(e) => setF({ ...f, objectif: e.target.value })} placeholder="Ce qui doit être livré et vérifié" />
        </label>
        <label className="block"><Libelle>Premier message</Libelle>
          <Zone rows={4} required value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
        </label>
        <div className="flex items-center justify-between rounded-[12px] bg-surface-2 px-4 py-3">
          <div><div className="text-[14px] font-bold">Autonomie</div><div className="text-[12.5px] text-discret">Relance seule jusqu’à l’objectif, compacte aux fins d’étape.</div></div>
          <Bascule active={f.autonomie} onChange={(v) => setF({ ...f, autonomie: v })} libelle="Autonomie" />
        </div>
        {erreur && <p className="rounded-[10px] bg-danger-fond px-3 py-2 text-[13px] font-semibold text-danger">{erreur}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Bouton variante="discret" onClick={surFermer}>Annuler</Bouton>
          <Bouton type="submit" variante="plein" disabled={envoi || !projet || !f.message.trim()} icone={<Rocket size={16} />}>
            {envoi ? 'Ouverture…' : 'Lancer la session'}
          </Bouton>
        </div>
      </form>
    </Dialogue>
  );
}
