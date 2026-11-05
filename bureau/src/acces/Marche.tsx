// Responsabilité : la marche à suivre pour brancher Claude sur Quart, une fois le jeton émis — claude.ai (connecteur
// personnalisé) ou Claude Code (MCP HTTP). Le jeton n'est montré qu'ici, une seule fois.
import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GenreAcces } from '../../../commun/api-clients.ts';
import { BlocCopie } from './BlocCopie.tsx';
import { commandeClaudeCode, urlConnecteur } from './branchement.ts';

function Etape({ n, children }: { readonly n: number; readonly children: ReactNode }): ReactNode {
  return (
    <li className="flex gap-2.5 text-[12.5px] leading-relaxed text-encre-2">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-fond font-mono text-[10.5px]
        font-bold text-accent-texte">{n}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function MarcheClaudeAi({ url }: { readonly url: string }): ReactNode {
  return (
    <ol className="flex flex-col gap-2.5">
      <Etape n={1}>Sur <b>claude.ai</b> : <b>Paramètres → Connecteurs → Ajouter un connecteur personnalisé</b>.</Etape>
      <Etape n={2}>Nom : <b>Quart</b>. URL du serveur MCP distant :<div className="mt-1.5"><BlocCopie texte={url}
        libelle="l’URL du connecteur" /></div></Etape>
      <Etape n={3}>Laisse les réglages OAuth vides, puis <b>Ajouter</b>.</Etape>
      <Etape n={4}>Dans une conversation, active <b>Quart</b> dans le menu des outils. Le connecteur suit ton compte :
        il marche aussi dans l’app Claude de bureau et sur l’iPhone.</Etape>
    </ol>
  );
}

function MarcheClaudeCode({ base, jeton }: { readonly base: string; readonly jeton: string }): ReactNode {
  return (
    <ol className="flex flex-col gap-2.5">
      <Etape n={1}>Dans un terminal de la machine (rien à installer) :<div className="mt-1.5">
        <BlocCopie texte={commandeClaudeCode(base, jeton)} libelle="la commande" /></div>
        <p className="mt-1 text-[11.5px] text-discret">Un MCP « quart » existe déjà ? D’abord
          {' '}<code className="font-mono">claude mcp remove -s user quart</code>.</p></Etape>
      <Etape n={2}>Ouvre une nouvelle session <code className="font-mono">claude</code> et tape <code
        className="font-mono">/mcp</code> : <b>quart</b> doit être connecté.</Etape>
      <Etape n={3}>Demande par exemple « ouvre une session sur la tour dans ccremote-dev pour… » : Claude utilise
        {' '}<code className="font-mono">quart_ouvrir</code>, la session apparaît ici.</Etape>
    </ol>
  );
}

export function Marche({ genre, base, jeton }: {
  readonly genre: Exclude<GenreAcces, 'appareil'>;
  readonly base: string;
  readonly jeton: string;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      {genre === 'claude-ai' ? <MarcheClaudeAi url={urlConnecteur(base, jeton)} />
        : <MarcheClaudeCode base={base} jeton={jeton} />}
      <p className="flex gap-2 rounded-[6px] bg-accent-fond px-3 py-2 text-[11.5px] leading-relaxed text-accent-texte">
        <ShieldAlert size={14} className="mt-0.5 shrink-0" />
        Ce jeton ne s’affichera plus. Il ouvre des sessions Claude sur tes machines : ne le partage pas. Tu peux le
        révoquer à tout moment depuis cet écran.
      </p>
    </div>
  );
}
