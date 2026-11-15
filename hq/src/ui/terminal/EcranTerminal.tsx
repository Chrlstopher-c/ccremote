// Responsabilité : le panneau terminal — un vieux poste cathodique (texte vert) qui ouvre un shell à distance sur une
// machine, dans un dossier ; bandeau de fin de session, bouton « Nouveau terminal », touches utiles sur téléphone.
import '@xterm/xterm/css/xterm.css';
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

import type { BilanTerminal } from '../../donnees';
import { useMondeBrut } from '../contexte';
import { Panneau } from '../Panneau';
import { TouchesMobiles } from './TouchesMobiles';
import { useTerminal } from './use-terminal';
import './terminal.css';

interface Props {
  readonly machine: string;
  readonly cwd?: string;
  readonly titre?: string;
}

function texteFin(bilan: BilanTerminal): string {
  if (bilan.erreur) return `Terminal interrompu : ${bilan.erreur}`;
  return bilan.code === null ? 'Session terminée.' : `Session terminée (code ${bilan.code}).`;
}

/** Le monde (Phaser) écoute le clavier sur window : la frappe dans le terminal ne doit pas lui parvenir (Échap si). */
function garderClavier(e: KeyboardEvent): void {
  if (e.key !== 'Escape') e.stopPropagation();
}

function Ecran(p: Props & { readonly surFin: (b: BilanTerminal) => void }) {
  const { source } = useMondeBrut();
  const conteneur = useRef<HTMLDivElement>(null);
  const poignee = useTerminal(conteneur, {
    ouvrirTerminal: source.ouvrirTerminal,
    machine: p.machine,
    cwd: p.cwd,
    surFin: p.surFin,
  });
  return (
    <>
      <div className="crt-ecran" onPointerUp={() => poignee.current?.focus()}>
        <div className="crt-xterm" ref={conteneur} />
        <div className="crt-balayage" aria-hidden />
      </div>
      <TouchesMobiles envoyer={(t) => poignee.current?.envoyer(t)} focus={() => poignee.current?.focus()} />
    </>
  );
}

export default function EcranTerminal(p: Props) {
  const [generation, setGeneration] = useState(0);
  const [fin, setFin] = useState<BilanTerminal | null>(null);
  const relancer = useCallback(() => {
    setFin(null);
    setGeneration((g) => g + 1);
  }, []);
  const action = (
    <button className="bouton-pixel" onClick={relancer}>
      Nouveau terminal
    </button>
  );
  return (
    <Panneau
      variante="crt"
      titre={p.titre ? `Terminal — ${p.titre}` : 'Terminal'}
      sousTitre={`${p.machine} · ${p.cwd ?? 'dossier d’accueil'}`}
      actions={action}
    >
      <div className="crt-corps" onKeyDown={garderClavier}>
        <Ecran key={generation} {...p} surFin={setFin} />
        {fin ? (
          <div className={`crt-fin ${fin.erreur ? 'erreur' : ''}`} role="status">
            <span>{texteFin(fin)}</span>
            <button className="bouton-pixel" onClick={relancer}>Rouvrir un shell</button>
          </div>
        ) : null}
      </div>
    </Panneau>
  );
}
