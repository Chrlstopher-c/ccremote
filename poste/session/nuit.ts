// Responsabilité : le mode nuit vu du poste — lire l'état que les crochets de la config Claude Code écrivent
// (~/.claude/night/sessions/<id>.json) et décider quand réveiller une session à l'arrêt dont Chris ne répond plus.
// Le poste est le filet : le hook Stop de Claude relance tant qu'il le peut (9 blocages sans action au plus), le poste
// reprend la main quand la session s'est arrêtée quand même.
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Nuit, StatutSession } from '../../commun/session.ts';

export const DELAI_REVEIL_MS = 6 * 60_000; // un peu plus que les 5 min d'attente du hook Stop : le hook passe d'abord
export const REVEILS_SANS_EFFET_MAX = 4;
const DUREE_MAX_H = 10;

export const TEXTE_REVEIL =
  'MODE NUIT — Chris ne répond plus depuis 6 min et ta session était à l’arrêt : reprends. Relis ton plan, termine ' +
  'tout ce qui reste, teste tout toi-même ; quand tout est fini et vérifié, lance `night done` puis termine par ' +
  '« À tester » uniquement. Pas de question, pas de liste de tâches.';

export const TEXTE_ACTIVATION =
  'MODE NUIT depuis Quart : je vais dormir, je te laisse gérer en autonomie. Mets en place ton plan, ' +
  'exécute-le jusqu’au bout, teste tout toi-même, puis `night done` et « À tester » uniquement.';
export const TEXTE_RETOUR =
  'Je suis là : mode nuit coupé. Fais le point en trois lignes : ce qui est fait, ce qu’il y a à tester.';

export function dossierNuit(): string {
  return process.env['QUART_NUIT_DIR'] ?? join(homedir(), '.claude', 'night');
}

/** L'état du mode nuit d'une session Claude, ou null s'il n'est pas actif (ou périmé). */
export function lireNuit(claudeSessionId: string | null, maintenantMs: number, reveils: number): Nuit | null {
  if (!claudeSessionId) return null;
  const chemin = join(dossierNuit(), 'sessions', `${claudeSessionId}.json`);
  if (!existsSync(chemin)) return null;
  try {
    const brut = JSON.parse(readFileSync(chemin, 'utf8')) as Record<string, unknown>;
    const since = Number(brut['since']);
    const depuisH = (maintenantMs - since * 1000) / 3_600_000;
    if (!Number.isFinite(depuisH) || depuisH > DUREE_MAX_H) return null;
    const ouvertes = brut['open'];
    return {
      depuisH: Math.round(depuisH * 10) / 10,
      casesOuvertes: typeof ouvertes === 'number' && ouvertes >= 0 ? ouvertes : null,
      relances: Number(brut['rounds'] ?? 0),
      reveils,
    };
  } catch {
    return null;
  }
}

/** Vrai (une seule fois) si `night done` vient de terminer le mode nuit de cette session avec succès. */
export function finReussie(claudeSessionId: string | null, maintenantMs: number): boolean {
  if (!claudeSessionId) return false;
  const chemin = join(dossierNuit(), 'sessions', `${claudeSessionId}.done`);
  if (!existsSync(chemin)) return false;
  try {
    const at = Number((JSON.parse(readFileSync(chemin, 'utf8')) as Record<string, unknown>)['at']);
    unlinkSync(chemin);
    return Number.isFinite(at) && maintenantMs - at * 1000 < 10 * 60_000;
  } catch {
    return false;
  }
}

export interface EtatVeille {
  readonly nuit: Nuit | null;
  readonly statut: StatutSession;
  readonly peutEcrire: boolean; // la session a un tmux : on peut lui coller un message
  readonly attenteDepuisMs: number | null; // depuis quand elle est à l'arrêt (null : au travail)
  readonly dernierReveilMs: number | null;
  readonly reveilsSansEffet: number;
  readonly messagesChrisEnVol: number;
  readonly maintenantMs: number;
}

export type Veille =
  | { readonly action: 'rien' }
  | { readonly action: 'reveiller'; readonly texte: string; readonly raison: string }
  | { readonly action: 'abandonner'; readonly raison: string };

export function deciderVeille(e: EtatVeille): Veille {
  if (!e.nuit || !e.peutEcrire || e.statut !== 'attente' || e.attenteDepuisMs === null) return { action: 'rien' };
  if (e.messagesChrisEnVol > 0) return { action: 'rien' };
  const reference = Math.max(e.attenteDepuisMs, e.dernierReveilMs ?? 0);
  if (e.maintenantMs - reference < DELAI_REVEIL_MS) return { action: 'rien' };
  if (e.reveilsSansEffet >= REVEILS_SANS_EFFET_MAX)
    return {
      action: 'abandonner',
      raison: `mode nuit : ${e.reveilsSansEffet} réveils sans effet, la session ne répond plus`,
    };
  return {
    action: 'reveiller',
    texte: TEXTE_REVEIL,
    raison: 'mode nuit : session à l’arrêt, 6 min sans réponse de Chris',
  };
}

/** Lance `night on|off` de la config Claude pour cette conversation ; message d'erreur, ou null si c'est fait. */
export async function basculerNuitClaude(
  claudeSessionId: string,
  active: boolean,
  objectif: string,
): Promise<string | null> {
  const cli = join(dossierNuit(), 'night');
  if (!existsSync(cli)) return 'mode nuit non installé sur cette machine (~/.claude/night)';
  const args = active ? ['on', objectif.slice(0, 300)] : ['off'];
  const proc = Bun.spawn([cli, ...args], {
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: claudeSessionId },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  return code === 0 ? null : `night ${args[0]} a échoué : ${(await new Response(proc.stderr).text()).slice(0, 200)}`;
}
