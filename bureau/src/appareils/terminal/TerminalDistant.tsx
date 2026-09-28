// Responsabilité : un terminal à distance dans l'app — xterm.js relié par WebSocket à un vrai PTY sur l'appareil.
// Marche partout où le relais répond (réseau local, 4G, web) : aucun SSH, aucun port ouvert côté client.
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { journal } from '../../shared/journal.ts';
import type { ApiAppareil } from '../api-appareil.ts';

export interface CibleTerminal {
  readonly tmux?: string;
  readonly dossier?: string;
}

type Etat =
  { readonly genre: 'connexion' } | { readonly genre: 'ouvert' } | { readonly genre: 'fin'; readonly texte: string };

function couleurs(): Record<string, string> {
  const s = getComputedStyle(document.documentElement);
  const v = (nom: string): string => s.getPropertyValue(nom).trim();
  return {
    background: v('--champ'),
    foreground: v('--encre'),
    cursor: v('--accent'),
    selectionBackground: v('--choix'),
  };
}

function brancher(api: ApiAppareil, cible: CibleTerminal, terminal: Terminal, surEtat: (e: Etat) => void): WebSocket {
  const ws = new WebSocket(api.urlTerminal(cible, terminal.cols, terminal.rows), ['ccremote', api.jeton]);
  ws.binaryType = 'arraybuffer';
  const encodeur = new TextEncoder();
  ws.onopen = () => surEtat({ genre: 'ouvert' });
  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) return terminal.write(new Uint8Array(e.data));
    const m = JSON.parse(String(e.data)) as { type: string; message?: string; code?: number | null };
    surEtat({ genre: 'fin', texte: m.type === 'fin' ? `terminé (code ${m.code ?? '—'})` : (m.message ?? 'erreur') });
  };
  ws.onclose = () => surEtat({ genre: 'fin', texte: 'déconnecté' });
  ws.onerror = () => journal.warn({ machine: api.machine }, 'terminal à distance : erreur de connexion');
  terminal.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(encodeur.encode(d)));
  terminal.onBinary((d) => ws.readyState === WebSocket.OPEN && ws.send(Uint8Array.from(d, (c) => c.charCodeAt(0))));
  terminal.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'taille', colonnes: cols, lignes: rows }));
  });
  return ws;
}

function creerTerminal(hote: HTMLDivElement): { terminal: Terminal; fit: FitAddon } {
  const terminal = new Terminal({
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 12.5,
    cursorBlink: true,
    theme: couleurs(),
    allowProposedApi: true,
    scrollback: 5000,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(new WebLinksAddon());
  terminal.open(hote);
  fit.fit();
  terminal.focus();
  return { terminal, fit };
}

interface PropsTerminal {
  readonly api: ApiAppareil;
  readonly cible: CibleTerminal;
  readonly actif: boolean;
  readonly generation: number;
}

// Un terminal vit de son montage à son démontage ; « Reconnecter » (generation) en rouvre un neuf.
function useXterm({ api, cible, actif, generation }: PropsTerminal) {
  const hote = useRef<HTMLDivElement>(null);
  const ajusteur = useRef<FitAddon | null>(null);
  const [etat, setEtat] = useState<Etat>({ genre: 'connexion' });
  useEffect(() => {
    if (!hote.current) return;
    setEtat({ genre: 'connexion' });
    const { terminal, fit } = creerTerminal(hote.current);
    ajusteur.current = fit;
    const ws = brancher(api, cible, terminal, setEtat);
    const observateur = new ResizeObserver(() => fit.fit());
    observateur.observe(hote.current);
    return () => {
      observateur.disconnect();
      ws.close();
      terminal.dispose();
    };
  }, [api, cible, generation]);
  useEffect(() => {
    if (actif) requestAnimationFrame(() => ajusteur.current?.fit());
  }, [actif]);
  return { hote, etat };
}

export function TerminalDistant(p: PropsTerminal): ReactNode {
  const { hote, etat } = useXterm(p);
  return (
    <div className={`relative min-h-0 flex-1 bg-champ p-2 ${p.actif ? 'flex' : 'hidden'}`}>
      <div ref={hote} className="min-h-0 flex-1" />
      {etat.genre !== 'ouvert' && (
        <div className="absolute top-2 right-3 rounded-[5px] bg-fond/90 px-2 py-0.5 font-mono text-[11px] text-discret">
          {etat.genre === 'connexion' ? 'connexion…' : etat.texte}
        </div>
      )}
    </div>
  );
}
