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
  readonly message?: { id?: unknown; content?: unknown; usage?: Objet; stop_reason?: unknown; model?: unknown };
  readonly compactMetadata?: Objet;
  readonly durationMs?: unknown; // `system` `turn_duration` : durée du tour, ms
  readonly toolUseResult?: unknown; // résultat d'outil relevé par Claude Code (diff d'une écriture)
  readonly totalCostUSD?: unknown; // `cost-state` : coût cumulé de la session, USD
  readonly customTitle?: unknown;
  readonly aiTitle?: unknown;
  readonly uuid?: unknown;
  readonly timestamp?: unknown; // horodatage de la ligne (ISO), relu pour l'historique
  readonly parentUuid?: unknown; // entrée précédente de la conversation (branche active)
  readonly logicalParentUuid?: unknown; // idem à travers une compaction
  readonly attachment?: {
    type?: unknown;
    prompt?: unknown;
    humanTurn?: unknown;
    origin?: { kind?: unknown };
    source_uuid?: unknown; // identifiant de l'envoi (message SDK) : la bulle déjà au fil porte le même
  };
  readonly isApiErrorMessage?: unknown;
  readonly origin?: { kind?: unknown; from?: unknown };
}

// Erreur d'API (connexion expirée, surcharge…) : le CLI l'écrit comme une réponse synthétique de l'assistant.
export function estErreurApi(l: Ligne): boolean {
  return l.type === 'assistant' && (l.isApiErrorMessage === true || l.message?.model === '<synthetic>');
}

// `agent` fourni : la ligne vient du transcript d'un sous-agent (toutes ses lignes sont `isSidechain`).
// L'identifiant de la ligne (uuid du transcript) rejoint les messages et textes du fil principal.
export function traduire(l: Ligne, agent?: string): Evenement[] {
  const evenements = traduireLigne(l, agent);
  const uuid = identifiantDeLigne(l);
  if (!uuid || agent !== undefined) return evenements;
  return evenements.map((evt) => (evt.type === 'message' || evt.type === 'texte' ? { ...evt, uuid } : evt));
}

// Un message mis en file pendant un tour a son uuid de ligne ; le fil connaît son envoi (source_uuid).
function identifiantDeLigne(l: Ligne): string {
  const envoi = l.attachment?.type === 'queued_command' ? texte(l.attachment.source_uuid) : '';
  return envoi || texte(l.uuid);
}

function traduireLigne(l: Ligne, agent?: string): Evenement[] {
  if (l.isSidechain === true && agent === undefined) return [];
  const marque = agent === undefined ? {} : { agent };
  if (estErreurApi(l) && agent === undefined) {
    const texteErreur = blocs(l.message?.content).map((b) => texte(b['text'])).join(' ').trim();
    return [{ type: 'erreur', message: texteErreur || 'erreur de l’API' }];
  }
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

const ENTETE_RELAIS = /^Another Claude session sent a message:\n/;
const PIED_RELAIS = /\n\nThis came from another Claude session[\s\S]*$/;

// Message tapé par Chris dans Lanterne et remis par Remote Control : Claude Code l'écrit en ligne « meta » venue
// d'une autre session, sans expéditeur nommé. C'est une bulle de Chris, sans l'habillage du harnais.
function messageRelaye(l: Ligne): string | null {
  if (l.origin?.kind !== 'peer' || l.origin.from !== 'unknown') return null;
  const contenu = l.message?.content;
  const brut =
    typeof contenu === 'string'
      ? contenu
      : blocs(contenu)
          .filter((b) => b.type === 'text')
          .map((b) => texte(b['text']))
          .join('\n');
  if (!ENTETE_RELAIS.test(brut)) return null;
  return brut.replace(ENTETE_RELAIS, '').replace(PIED_RELAIS, '').trim() || null;
}

function traduireUtilisateur(l: Ligne): Evenement[] {
  const relaye = messageRelaye(l);
  if (relaye !== null) return messageDeChris(relaye);
  if (l.isMeta === true || l.isCompactSummary === true) return [];
  const contenu = l.message?.content;
  if (typeof contenu === 'string') {
    return contenu.trimStart().startsWith('<task-notification>')
      ? resultatDeNotification(contenu)
      : messageDeChris(contenu);
  }
  const r = resultats(l, {});
  if (r.length > 0) return r;
  const brut = blocs(contenu)
    .filter((b) => b.type === 'text')
    .map((b) => texte(b['text']))
    .join('\n');
  return brut.trimStart().startsWith('<task-notification>') ? resultatDeNotification(brut) : messageDeChris(brut);
}

// Fin d'une tâche de fond (sous-agent, commande en arrière-plan) : le CLI la met en file sous forme de
// <task-notification>, en pièce jointe ou en tour utilisateur. Elle complète l'outil lancé, jamais une bulle.
// Un message de Chris envoyé pendant un tour arrive aussi en file (`humanTurn`), texte seul ou blocs (texte, images) :
// c'est une bulle comme un message normal (ses images sont relues à part, voir historique.ts).
function finDeTache(l: Ligne): Evenement[] {
  if (l.attachment?.type !== 'queued_command') return [];
  const brut = l.attachment.prompt;
  const prompt =
    typeof brut === 'string'
      ? brut
      : blocs(brut)
          .filter((b) => b.type === 'text')
          .map((b) => texte(b['text']))
          .join('\n');
  if (prompt.includes('<task-notification>')) return resultatDeNotification(prompt);
  return messageEnFile(l) ? messageDeChris(prompt) : [];
}

/** Message de Chris mis en file pendant un tour (pas une notification de tâche ni une commande interne). */
export function messageEnFile(l: Ligne): boolean {
  const a = l.attachment;
  return a?.type === 'queued_command' && (a.humanTurn === true || a.origin?.kind === 'human');
}

function resultatDeNotification(prompt: string): Evenement[] {
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
  if (/^<(local-command|system-reminder|command-message|task-notification)/.test(brut.trim())) return [];
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
  if (l.type !== 'assistant' || l.isSidechain === true || !l.message?.usage || estErreurApi(l)) return null;
  const u = l.message.usage;
  return nombre(u['input_tokens']) + nombre(u['cache_read_input_tokens']) + nombre(u['cache_creation_input_tokens']);
}

// Le transcript ne dit pas si Claude travaille ; sa dernière ligne utile le laisse deviner.
export function travailEnCours(l: Ligne): boolean | null {
  if (l.isSidechain === true) return null;
  if (l.type === 'user' && l.isMeta !== true) return true;
  if (estErreurApi(l)) return false;
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
