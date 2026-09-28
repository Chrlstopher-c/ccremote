// Responsabilité : l'éditeur de fichiers texte de l'appareil — CodeMirror avec la coloration du langage, Ctrl+S
// pour enregistrer sur l'appareil, aperçu rendu pour le Markdown.
import { indentWithTab } from '@codemirror/commands';
import { languages } from '@codemirror/language-data';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { Eye, Pencil, Save } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ErreurApi } from '../../shared/api/client.ts';
import { Bouton } from '../../shared/ui/Bouton.tsx';
import type { ApiAppareil } from '../api-appareil.ts';

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'var(--champ)', color: 'var(--encre)' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", monospace' },
  '.cm-gutters': { backgroundColor: 'var(--champ)', color: 'var(--discret)', borderRight: '1px solid var(--filet)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--survol)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--choix)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
});

async function langage(nom: string) {
  const description =
    languages.find((l) => l.extensions.some((e) => nom.toLowerCase().endsWith(`.${e}`))) ??
    languages.find((l) => l.filename?.test(nom));
  return description ? [await description.load()] : [];
}

function useVueCodeMirror(
  hote: React.RefObject<HTMLDivElement | null>,
  nom: string,
  texte: string,
  surModif: () => void,
  surEnregistrer: () => void,
) {
  const vue = useRef<EditorView | null>(null);
  const rappels = useRef({ surModif, surEnregistrer });
  rappels.current = { surModif, surEnregistrer };
  useEffect(() => {
    let detruit = false;
    void langage(nom).then((lang) => {
      if (detruit || !hote.current) return;
      vue.current = new EditorView({
        parent: hote.current,
        state: EditorState.create({
          doc: texte,
          extensions: [
            basicSetup,
            theme,
            ...lang,
            keymap.of([indentWithTab, { key: 'Mod-s', run: () => (rappels.current.surEnregistrer(), true) }]),
            EditorView.updateListener.of((u) => u.docChanged && rappels.current.surModif()),
          ],
        }),
      });
    });
    return () => {
      detruit = true;
      vue.current?.destroy();
    };
  }, [hote, nom, texte]);
  return vue;
}

export default function Editeur({
  api,
  chemin,
  nom,
  texte,
  markdown,
}: {
  readonly api: ApiAppareil;
  readonly chemin: string;
  readonly nom: string;
  readonly texte: string;
  readonly markdown: boolean;
}): ReactNode {
  const hote = useRef<HTMLDivElement>(null);
  const [modifie, setModifie] = useState(false);
  const [rendu, setRendu] = useState(markdown);
  const [message, setMessage] = useState<string | null>(null);
  const enregistrer = async (): Promise<void> => {
    const contenu = vue.current?.state.doc.toString();
    if (contenu === undefined) return;
    try {
      await api.deposer(chemin, contenu);
      setModifie(false);
      setMessage(`Enregistré sur ${api.machine}.`);
    } catch (e) {
      setMessage(e instanceof ErreurApi ? e.message : String(e));
    }
  };
  const vue = useVueCodeMirror(
    hote,
    nom,
    texte,
    () => setModifie(true),
    () => void enregistrer(),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-filet px-3">
        <span className="flex-1 font-mono text-[11.5px] text-discret">{message ?? (modifie ? 'modifié' : '')}</span>
        {markdown && (
          <Bouton icone={rendu ? <Pencil size={12} /> : <Eye size={12} />} onClick={() => setRendu((r) => !r)}>
            {rendu ? 'Éditer' : 'Aperçu'}
          </Bouton>
        )}
        <Bouton ton="accent" icone={<Save size={12} />} disabled={!modifie} onClick={() => void enregistrer()}>
          Enregistrer
        </Bouton>
      </div>
      {rendu && (
        <div className="prose-fil selectionnable min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[13.5px]">
          <Markdown remarkPlugins={[remarkGfm]}>{vue.current?.state.doc.toString() ?? texte}</Markdown>
        </div>
      )}
      <div ref={hote} className={`min-h-0 flex-1 overflow-hidden ${rendu ? 'hidden' : ''}`} />
    </div>
  );
}
