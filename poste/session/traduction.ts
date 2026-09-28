// Responsabilité : traduire une ligne du transcript JSONL de Claude Code en événements du fil. Pur, sans I/O.
// Le transcript est la seule source de vérité : il contient aussi ce que Chris tape directement dans le terminal.
// Fil principal : les lignes `isSidechain` sont ignorées. Un sous-agent a son propre transcript, traduit avec `agent`.
import type { Evenement } from '../../commun/session.ts';

const TAILLE_DETAIL = 8_000;
const TAILLE_RESULTAT = 3_000;
const PREFIXE_OUTILS_HARNESS = 'mcp__ccremote__';
const OUTILS_SOUS_AGENT = new Set(['Agent', 'Task']);

type Objet = Record<string, unknown>;
type Bloc = Objet & { type: string };

export interface Ligne {
  readonly type?: unknown;
  readonly subtype?: unknown;
  readonly isSidechain?: unknown;
  readonly isMeta?: unknown;
  readonly isCompactSummary?: unknown;
  readonly message?: { content?: unknown; usage?: Objet; stop_reason?: unknown; model?: unknown };
  readonly compactMetadata?: Objet;
  readonly customTitle?: unknown;
  readonly attachment?: { type?: unknown; prompt?: unknown };
}

// `agent` fourni : la ligne vient du transcript d'un sous-agent (toutes ses lignes sont `isSidechain`).
export function traduire(l: Ligne, agent?: string): Evenement[] {
  if (l.isSidechain === true && agent === undefined) return [];
  const marque = agent === undefined ? {} : { agent };
  if (l.type === 'assistant') return blocs(l.message?.content).flatMap((b) => traduireBlocAssistant(b, marque));
  if (l.type === 'user') return agent === undefined ? traduireUtilisateur(l) : resultats(l, marque);
  if (l.type === 'attachment' && agent === undefined) return finDeTache(l);
  if (l.type === 'system' && l.subtype === 'compact_boundary' && agent === undefined) {
    const m = l.compactMetadata ?? {};
    return [
      {
        type: 'compaction',
        avant: nombre(m['preTokens']),
        apres: nombre(m['postTokens']),
        declencheur: texte(m['trigger']),
      },
    ];
  }
  return [];
}

function traduireUtilisateur(l: Ligne): Evenement[] {
  if (l.isMeta === true || l.isCompactSummary === true) return [];
  const contenu = l.message?.content;
  if (typeof contenu === 'string') return messageDeChris(contenu);
  const r = resultats(l, {});
  if (r.length > 0) return r;
  return messageDeChris(
    blocs(contenu)
      .filter((b) => b.type === 'text')
      .map((b) => texte(b['text']))
      .join('\n'),
  );
}

// Fin d'un sous-agent lancé en arrière-plan : le CLI la met en file sous forme de <task-notification>.
function finDeTache(l: Ligne): Evenement[] {
  const prompt = l.attachment?.type === 'queued_command' ? texte(l.attachment.prompt) : '';
  if (!prompt.includes('<task-notification>')) return [];
  const champ = (nom: string): string => prompt.match(new RegExp(`<${nom}>([\\s\\S]*?)</${nom}>`))?.[1]?.trim() ?? '';
  const outilId = champ('tool-use-id');
  if (!outilId) return [];
  return [
    {
      type: 'resultat_outil',
      outilId,
      extrait: champ('summary') || 'terminé',
      erreur: champ('status') !== 'completed',
    },
  ];
}

// Une commande tapée (/compact …) arrive balisée ; ses sorties locales et les rappels système ne sont pas des messages.
function messageDeChris(brut: string): Evenement[] {
  if (/^<(local-command|system-reminder|command-message)/.test(brut.trim())) return [];
  const commande = brut.match(/<command-name>([^<]*)<\/command-name>/);
  const texteFinal = commande
    ? `${commande[1]} ${brut.match(/<command-args>([^<]*)<\/command-args>/)?.[1] ?? ''}`.trim()
    : brut.trim();
  return texteFinal ? [{ type: 'message', texte: texteFinal }] : [];
}

function traduireBlocAssistant(bloc: Bloc, marque: { agent?: string }): Evenement[] {
  if (bloc.type === 'text' && texte(bloc['text']).trim())
    return [{ type: 'texte', texte: texte(bloc['text']), ...marque }];
  if (bloc.type === 'thinking' && texte(bloc['thinking']).trim()) {
    return [{ type: 'reflexion', texte: texte(bloc['thinking']), ...marque }];
  }
  if (bloc.type !== 'tool_use') return [];
  const nom = texte(bloc['name']);
  const id = texte(bloc['id']);
  const entree = (bloc['input'] ?? {}) as Objet;
  if (!nom || nom.startsWith(PREFIXE_OUTILS_HARNESS)) return [];
  if (OUTILS_SOUS_AGENT.has(nom) && marque.agent === undefined) {
    return [
      {
        type: 'sous_agent',
        id,
        description: texte(entree['description']),
        modele: texte(entree['model']),
        genre: texte(entree['subagent_type']) || 'general-purpose',
      },
    ];
  }
  return [{ type: 'outil', id, nom, resume: resumerEntree(nom, entree), detail: detailEntree(entree), ...marque }];
}

function resultats(l: Ligne, marque: { agent?: string }): Evenement[] {
  return blocs(l.message?.content)
    .filter((b) => b.type === 'tool_result')
    .map((bloc) => {
      const brut = bloc['content'];
      const contenu =
        typeof brut === 'string'
          ? brut
          : blocs(brut)
              .map((b) => texte(b['text']))
              .join('\n');
      return {
        type: 'resultat_outil' as const,
        outilId: texte(bloc['tool_use_id']),
        extrait: contenu.slice(0, TAILLE_RESULTAT),
        erreur: bloc['is_error'] === true,
        ...marque,
      };
    });
}

export function resumerEntree(nom: string, entree: Objet): string {
  const champ = {
    Bash: 'command',
    Read: 'file_path',
    Edit: 'file_path',
    Write: 'file_path',
    Grep: 'pattern',
    Glob: 'pattern',
    WebFetch: 'url',
    WebSearch: 'query',
    Skill: 'skill',
  }[nom];
  const valeur = champ ? texte(entree[champ]) : JSON.stringify(entree);
  return valeur.length > 200 ? `${valeur.slice(0, 200)}…` : valeur;
}

function detailEntree(entree: Objet): string {
  const t = JSON.stringify(entree, null, 1);
  return t.length > TAILLE_DETAIL ? `${t.slice(0, TAILLE_DETAIL)}…` : t;
}

// Contexte relu au prochain tour = input + cache lu + cache créé du dernier appel du fil principal.
export function contexteDe(l: Ligne): number | null {
  if (l.type !== 'assistant' || l.isSidechain === true || !l.message?.usage) return null;
  const u = l.message.usage;
  return nombre(u['input_tokens']) + nombre(u['cache_read_input_tokens']) + nombre(u['cache_creation_input_tokens']);
}

// Le transcript ne dit pas si Claude travaille ; sa dernière ligne utile le laisse deviner.
export function travailEnCours(l: Ligne): boolean | null {
  if (l.isSidechain === true) return null;
  if (l.type === 'user' && l.isMeta !== true) return true;
  if (l.type === 'assistant') return l.message?.stop_reason !== 'end_turn';
  if (l.type === 'system' && l.subtype === 'turn_duration') return false;
  return null;
}

function blocs(contenu: unknown): Bloc[] {
  if (!Array.isArray(contenu)) return [];
  return contenu.filter((b): b is Bloc => typeof b === 'object' && b !== null && typeof b.type === 'string');
}

function texte(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function nombre(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
