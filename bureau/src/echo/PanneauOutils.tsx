// Responsabilité : les outils d'Echo dans la barre du mode Echo — ses MCP par machine avec leur état, et la relance
// (après un nouveau MCP ou une mise à jour : Echo relit la config du parc au démarrage).
import { Plug, RotateCw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useState } from 'react';
import type { McpEcho } from '../../../commun/echo.ts';

const BOUTON = 'grid size-8 cursor-default place-items-center rounded-[10px] transition-colors';
const PANNEAU =
  'absolute top-10 right-0 z-20 w-[320px] rounded-[14px] border border-filet bg-fond p-3 ' +
  'shadow-[0_1px_0_var(--filet),0_24px_48px_-24px_rgba(20,10,40,.5)]';
const TON: Record<string, string> = { connected: 'bg-succes', pending: 'bg-alerte', 'needs-auth': 'bg-alerte' };
const LIBELLE: Record<string, string> = {
  connected: 'connecté',
  pending: 'connexion…',
  'needs-auth': 'à autoriser',
  failed: 'échec',
  disabled: 'désactivé',
};

function Groupe({ machine, serveurs }: { readonly machine: string; readonly serveurs: readonly McpEcho[] }): ReactNode {
  return (
    <div className="mt-2">
      <div className="font-mono text-[10px] tracking-[.1em] text-discret uppercase">{machine}</div>
      {serveurs.map((s) => (
        <div key={s.nom} className="flex items-center gap-2 py-0.5 text-[12px]">
          <span className={`size-1.5 shrink-0 rounded-full ${TON[s.statut] ?? 'bg-danger'}`} />
          <span className="min-w-0 flex-1 truncate text-encre">{s.nom.replace(/^claude\.ai /, '')}</span>
          <span className="font-mono text-[10px] text-discret">{LIBELLE[s.statut] ?? s.statut}</span>
        </div>
      ))}
    </div>
  );
}

function Panneau(p: { readonly mcp: readonly McpEcho[]; readonly relancer: () => void }): ReactNode {
  const machines = [...new Set(p.mcp.map((s) => s.machine))];
  const ok = p.mcp.filter((s) => s.statut === 'connected').length;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
      className={PANNEAU}
    >
      <p className="text-[12.5px] text-encre-2">
        {p.mcp.length ? `${ok} / ${p.mcp.length} outils connectés.` : 'Echo démarre : outils en cours de connexion…'}
      </p>
      <div className="max-h-[50vh] overflow-y-auto">
        {machines.map((m) => (
          <Groupe key={m} machine={m} serveurs={p.mcp.filter((s) => s.machine === m)} />
        ))}
      </div>
      <button
        type="button"
        onClick={p.relancer}
        className="mt-3 flex h-8 cursor-default items-center gap-1.5 rounded-[10px] bg-accent px-3 text-[12.5px] font-bold text-white"
      >
        <RotateCw size={13} /> Relancer Echo
      </button>
      <p className="mt-2 text-[11px] leading-snug text-discret">
        Relit les MCP de chaque machine et la config Claude synchronisée. La conversation reprend où elle en était.
      </p>
    </motion.div>
  );
}

export function PanneauOutils(p: { readonly mcp: readonly McpEcho[]; readonly relancer: () => void }): ReactNode {
  const [ouvert, setOuvert] = useState(false);
  const probleme = p.mcp.some((s) => s.statut === 'failed');
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        title="Outils d'Echo"
        aria-label="Outils d'Echo"
        className={`${BOUTON} ${ouvert ? 'bg-accent-fond text-accent-texte' : 'text-discret hover:bg-survol hover:text-encre'}`}
      >
        <Plug size={15} className={probleme ? 'text-danger' : ''} />
      </button>
      <AnimatePresence>
        {ouvert && (
          <Panneau
            mcp={p.mcp}
            relancer={() => {
              p.relancer();
              setOuvert(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
