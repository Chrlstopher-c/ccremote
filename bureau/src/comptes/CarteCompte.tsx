// Responsabilité : un compte Claude Code — son usage (fenêtre de 5 h, semaine, plafonds par modèle) et les machines
// où il est connecté, avec de quoi l'ajouter ailleurs ou l'y retirer.
import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FenetreUsage } from '../../../commun/comptes.ts';
import { dans, depuis } from '../shared/format.ts';
import { Bouton, IconeBouton } from '../shared/ui/Bouton.tsx';
import { Jauge, Point, type TonPoint } from '../shared/ui/elements.tsx';
import type { CompteClaude, Installation } from './regroupement.ts';

function LigneUsage({ f }: { readonly f: FenetreUsage }): ReactNode {
  return (
    <div className="grid grid-cols-[150px_1fr_52px_150px] items-center gap-3 text-[12px]">
      <span className="text-encre-2">{f.libelle}</span>
      <Jauge valeur={f.pourcent / 100} alerte={0.8} />
      <span className="text-right font-mono tabular-nums text-encre">{`${Math.round(f.pourcent)} %`}</span>
      <span className="font-mono text-[11px] text-discret">
        {f.reinitialiseLe ? `remise à zéro ${dans(f.reinitialiseLe)}` : ''}
      </span>
    </div>
  );
}

function tonInstallation(i: Installation): TonPoint {
  if (!i.enLigne) return 'eteint';
  if (!i.etat.connecte) return 'alerte';
  return i.etat.probleme ? 'actif' : 'calme';
}

function LigneInstallation({ i, retirer }: {
  readonly i: Installation;
  readonly retirer: (i: Installation) => void;
}): ReactNode {
  const note = !i.enLigne ? 'machine hors ligne' : !i.etat.connecte ? 'déconnecté' : i.etat.probleme;
  return (
    <div className="group flex h-8 items-center gap-2.5 rounded-[6px] px-2 text-[12.5px] hover:bg-survol">
      <Point ton={tonInstallation(i)} />
      <span className="w-24 font-semibold text-encre">{i.machine}</span>
      <span className="font-mono text-[11.5px] text-discret">
        {i.etat.defaut ? `${i.etat.id} · par défaut` : i.etat.id}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-discret" title={note ?? ''}>{note}</span>
      {i.etat.releveLe && <span className="text-[11px] text-discret">{`relevé ${depuis(i.etat.releveLe)}`}</span>}
      {!i.etat.defaut && (
        <IconeBouton aide={`Retirer de ${i.machine}`} ton="danger" disabled={!i.enLigne}
          className="opacity-0 group-hover:opacity-100" onClick={() => retirer(i)}>
          <Trash2 size={13} />
        </IconeBouton>
      )}
    </div>
  );
}

export function CarteCompte({ c, ajouter, retirer, peutAjouter }: {
  readonly c: CompteClaude;
  readonly ajouter: (c: CompteClaude) => void;
  readonly retirer: (i: Installation) => void;
  readonly peutAjouter: boolean;
}): ReactNode {
  const u = c.usage;
  return (
    <section className="border-b border-filet px-5 py-4">
      <header className="mb-3 flex items-center gap-2">
        <h3 className="text-[14px] font-bold text-encre">{c.email ?? 'Compte non identifié'}</h3>
        {c.abonnement && (
          <span className="rounded-full bg-accent-fond px-2 py-px text-[11px] font-semibold text-accent-texte">
            {c.abonnement}
          </span>
        )}
        <span className="flex-1" />
        {c.email && (
          <Bouton icone={<Plus size={13} />} disabled={!peutAjouter} onClick={() => ajouter(c)}>
            Ajouter à une machine
          </Bouton>
        )}
      </header>
      <div className="mb-3 flex flex-col gap-1.5">
        {u ? [u.session, u.semaine, ...u.autres].map((f) => f && <LigneUsage key={f.libelle} f={f} />)
          : <p className="text-[12px] text-discret">Usage non relevé : aucune installation n’a de jeton lisible.</p>}
      </div>
      <div className="flex flex-col">
        {c.installations.map((i) => <LigneInstallation key={`${i.machine}/${i.etat.id}`} i={i} retirer={retirer} />)}
      </div>
    </section>
  );
}
