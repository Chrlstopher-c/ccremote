// Responsabilité : brancher un xterm.js sur une session de terminal de la source (démo ou relais) — ouverture,
// saisie, sortie, ajustement à la taille du cadre, focus, et fermeture propre quand le composant disparaît.
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, type RefObject } from 'react';

import type { BilanTerminal, FabriqueTerminal, SessionTerminal } from '../../donnees';
import { journaliserTerminal } from './journal';
import { policeMono, THEME_CRT } from './xterm-theme';

export interface OptionsUseTerminal {
  readonly ouvrirTerminal: FabriqueTerminal;
  readonly machine: string;
  readonly cwd?: string;
  readonly surFin: (bilan: BilanTerminal) => void;
}

export interface PoigneeTerminal {
  envoyer(texte: string): void;
  focus(): void;
}

function creerXterm(): { term: Terminal; fit: FitAddon } {
  const term = new Terminal({
    theme: THEME_CRT,
    fontFamily: policeMono(),
    fontSize: 14,
    lineHeight: 1.15,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 5000,
    allowProposedApi: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  return { term, fit };
}

function ajuster(fit: FitAddon): void {
  try {
    fit.fit();
  } catch (erreur) {
    journaliserTerminal('ajustement impossible', { erreur: String(erreur) });
  }
}

function ouvrirSession(o: OptionsUseTerminal, term: Terminal): SessionTerminal {
  const cible = { type: 'shell' as const, ...(o.cwd ? { dossier: o.cwd } : {}) };
  const session = o.ouvrirTerminal({ machine: o.machine, cible, colonnes: term.cols, lignes: term.rows });
  session.surSortie((texte) => term.write(texte));
  session.surFin((bilan) => {
    if (bilan.erreur) journaliserTerminal('terminal terminé en erreur', { machine: o.machine, erreur: bilan.erreur });
    o.surFin(bilan);
  });
  return session;
}

async function chargerPolice(): Promise<void> {
  try {
    await document.fonts.load('14px "JetBrains Mono"');
  } catch (erreur) {
    journaliserTerminal('police du terminal indisponible', { erreur: String(erreur) });
  }
}

interface Montage {
  readonly poignee: PoigneeTerminal;
  demonter(): void;
}

function monter(element: HTMLDivElement, o: OptionsUseTerminal): Montage | null {
  const { term, fit } = creerXterm();
  term.open(element);
  ajuster(fit);
  let session: SessionTerminal;
  try {
    session = ouvrirSession(o, term);
  } catch (erreur) {
    journaliserTerminal('ouverture du terminal impossible', { erreur: String(erreur) });
    o.surFin({ code: null, erreur: 'ouverture du terminal impossible' });
    term.dispose();
    return null;
  }
  const saisie = term.onData((texte) => session.ecrire(texte));
  const taille = term.onResize(({ cols, rows }) => session.redimensionner(cols, rows));
  const observateur = new ResizeObserver(() => ajuster(fit));
  observateur.observe(element);
  let actif = true;
  void chargerPolice().then(() => {
    if (!actif) return;
    term.options.fontFamily = policeMono();
    ajuster(fit);
  });
  term.focus();
  const demonter = (): void => {
    actif = false;
    observateur.disconnect();
    saisie.dispose();
    taille.dispose();
    session.fermer();
    term.dispose();
  };
  return { poignee: { envoyer: (texte) => session.ecrire(texte), focus: () => term.focus() }, demonter };
}

/** Monte le terminal dans `conteneur` ; renvoie une poignée pour envoyer des touches depuis l'extérieur. */
export function useTerminal(
  conteneur: RefObject<HTMLDivElement | null>,
  o: OptionsUseTerminal,
): RefObject<PoigneeTerminal | null> {
  const poignee = useRef<PoigneeTerminal | null>(null);
  const options = useRef(o);
  options.current = o;
  useEffect(() => {
    const element = conteneur.current;
    if (!element) return;
    const montage = monter(element, { ...options.current, surFin: (b) => options.current.surFin(b) });
    poignee.current = montage?.poignee ?? null;
    return () => {
      poignee.current = null;
      montage?.demonter();
    };
  }, [conteneur, o.machine, o.cwd]);
  return poignee;
}
