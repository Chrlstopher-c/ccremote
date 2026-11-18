// Responsabilité : traduire la réponse `getContextUsage` du SDK (le détail de /context) vers la forme du panneau
// Contexte. Pur : la réponse du SDK entre, la forme commune sort.
import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import type { CategorieContexte, ContexteSession, GenreCategorie, OutilMcp } from '../../commun/panneau.ts';

type Categorie = SDKControlGetContextUsageResponse['categories'][number];
type OutilSdk = SDKControlGetContextUsageResponse['mcpTools'][number];

const GENRES: Record<Categorie['kind'], GenreCategorie> = {
  used: 'utilise',
  free: 'libre',
  buffer: 'tampon',
  deferred: 'differe',
};
const PREFIXE_MCP = 'mcp__';

export function contexteDe(reponse: SDKControlGetContextUsageResponse): ContexteSession {
  const categories = reponse.categories.map(categorieDe);
  return {
    modele: reponse.model,
    fenetre: reponse.rawMaxTokens,
    utilises: reponse.totalTokens,
    pourcentage: reponse.percentage,
    categories: categories.filter((categorie) => categorie.genre !== 'differe'),
    categoriesDifferees: categories.filter((categorie) => categorie.genre === 'differe'),
    outilsMcp: reponse.mcpTools.map(outilDe),
    fichiersMemoire: reponse.memoryFiles.map((fichier) => ({
      chemin: fichier.path,
      type: fichier.type,
      jetons: fichier.tokens,
    })),
  };
}

function categorieDe(categorie: Categorie): CategorieContexte {
  return {
    id: categorie.id ?? categorie.name,
    libelle: categorie.name,
    jetons: categorie.tokens,
    genre: GENRES[categorie.kind],
  };
}

// Le nom d'outil du SDK est `mcp__<serveur>__<outil>` ; le serveur le donne à part, l'outil est ce qui reste.
function outilDe(outil: OutilSdk): OutilMcp {
  const prefixe = `${PREFIXE_MCP}${outil.serverName}__`;
  return {
    serveur: outil.serverName,
    outil: outil.name.startsWith(prefixe) ? outil.name.slice(prefixe.length) : outil.name,
    jetons: outil.tokens,
    differe: outil.isLoaded === false,
  };
}
