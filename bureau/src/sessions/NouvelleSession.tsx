// Responsabilité : ouvrir une session — où elle tourne, sur quel projet de cette machine (ou un emplacement libre),
// avec quel objectif.
import { Rocket } from 'lucide-react';
import type { ReactNode } from 'react';
import type { EtatCompte } from '../../../commun/comptes.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';
import { Dialogue } from '../shared/ui/Dialogue.tsx';
import { Bascule, Champ, Choix, Libelle, Zone } from '../shared/ui/elements.tsx';
import { AUCUN_PROJET, useNouvelleSession } from './useNouvelleSession.ts';

const MODELES = [
  ['', 'Par défaut (réglages de Claude Code)'],
  ['opus', 'Opus'],
  ['sonnet', 'Sonnet'],
  ['haiku', 'Haiku'],
] as const;
type Etat = ReturnType<typeof useNouvelleSession>;

function libelleCompte(c: EtatCompte): string {
  const usage = c.session ? ` · ${Math.round(c.session.pourcent)} %` : '';
  return `${c.id}${c.email ? ` · ${c.email}` : ''}${usage}`;
}

function Options({ valeurs }: { readonly valeurs: readonly (readonly [string, string])[] }): ReactNode {
  return valeurs.map(([v, l]) => (
    <option key={v} value={v}>
      {l}
    </option>
  ));
}

function ChoixCompte({ n }: { readonly n: Etat }): ReactNode {
  return (
    <label className="block">
      <Libelle detail="usage de la fenêtre de 5 h">Compte Claude Code</Libelle>
      <Choix value={n.f.compte} onChange={(e) => n.setF({ ...n.f, compte: e.target.value })}>
        <Options valeurs={n.comptes.map((c) => [c.id, libelleCompte(c)] as const)} />
      </Choix>
    </label>
  );
}

function Emplacement({ n }: { readonly n: Etat }): ReactNode {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <Libelle>Machine</Libelle>
          <Choix value={n.machine} onChange={(e) => n.choisirMachine(e.target.value)}>
            <Options valeurs={n.enLigne.map((m) => [m.id, m.id] as const)} />
          </Choix>
        </label>
        <label>
          <Libelle>Modèle</Libelle>
          <Choix value={n.f.modele} onChange={(e) => n.setF({ ...n.f, modele: e.target.value })}>
            <Options valeurs={MODELES} />
          </Choix>
        </label>
      </div>
      {n.comptes.length > 1 && <ChoixCompte n={n} />}
      <label className="block">
        <Libelle detail={`projets de ${n.machine || '…'}`}>Projet</Libelle>
        <Choix value={n.cleProjet} onChange={(e) => n.setCleProjet(e.target.value)}>
          <option value={AUCUN_PROJET}>Aucun projet — un emplacement</option>
          <Options valeurs={n.projets.map((p) => [n.cle(p), p.nom] as const)} />
        </Choix>
      </label>
      {n.cleProjet === AUCUN_PROJET && (
        <label className="block">
          <Libelle detail="~ = ton dossier personnel sur la machine">Emplacement</Libelle>
          <Champ value={n.emplacement} onChange={(e) => n.setEmplacement(e.target.value)} placeholder="~" />
        </label>
      )}
    </>
  );
}

function Consignes({ n }: { readonly n: Etat }): ReactNode {
  return (
    <>
      <label className="block">
        <Libelle detail="facultatif">Titre</Libelle>
        <Champ
          value={n.f.titre}
          onChange={(e) => n.setF({ ...n.f, titre: e.target.value })}
          placeholder="Déduit du premier message"
        />
      </label>
      <label className="block">
        <Libelle detail="la session travaille jusqu’à l’atteindre">Objectif</Libelle>
        <Zone
          rows={2}
          value={n.f.objectif}
          onChange={(e) => n.setF({ ...n.f, objectif: e.target.value })}
          placeholder="Ce qui doit être livré et vérifié"
        />
      </label>
      <label className="block">
        <Libelle>Premier message</Libelle>
        <Zone rows={4} required value={n.f.message} onChange={(e) => n.setF({ ...n.f, message: e.target.value })} />
      </label>
      <div className="flex items-center justify-between rounded-[6px] bg-champ px-3 py-2">
        <div>
          <div className="text-[13px] font-semibold">Autonomie</div>
          <div className="text-[11.5px] text-discret">Relance seule jusqu’à l’objectif, compacte aux fins d’étape.</div>
        </div>
        <Bascule active={n.f.autonomie} onChange={(v) => n.setF({ ...n.f, autonomie: v })} libelle="Autonomie" />
      </div>
    </>
  );
}

export function NouvelleSession({
  ouvert,
  surFermer,
  surOuverte,
  machine,
}: {
  readonly ouvert: boolean;
  readonly surFermer: () => void;
  readonly surOuverte: (id: string) => void;
  readonly machine?: string;
}): ReactNode {
  const n = useNouvelleSession(ouvert, surOuverte, machine);
  return (
    <Dialogue ouvert={ouvert} surFermer={surFermer} titre="Nouvelle session" largeur={560}>
      <form onSubmit={(e) => void n.soumettre(e)} className="space-y-3">
        <Emplacement n={n} />
        <Consignes n={n} />
        {n.erreur && <p className="text-[12px] text-danger">{n.erreur}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Bouton onClick={surFermer}>Annuler</Bouton>
          <Bouton
            type="submit"
            ton="accent"
            disabled={n.envoi || !n.projet || !n.f.message.trim()}
            icone={<Rocket size={13} />}
          >
            {n.envoi ? 'Ouverture…' : 'Lancer la session'}
          </Bouton>
        </div>
      </form>
    </Dialogue>
  );
}
