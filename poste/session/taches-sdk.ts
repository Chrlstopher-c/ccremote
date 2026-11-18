// Responsabilité : le registre des tâches de fond d'une session SDK (sous-agents, commandes, workflows), alimenté
// message par message depuis le flux du SDK et lu par le panneau de session. Un message inconnu n'a aucun effet.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { DetailTacheSession, StatutTache, TacheSession } from '../../commun/panneau.ts';

const MAX_TERMINEES = 50;
const MAX_MODELES = 200;
const OUTILS_SOUS_AGENT = new Set(['Agent', 'Task']);
const STATUT_MISE_A_JOUR: Record<string, StatutTache> = {
  pending: 'en_attente',
  running: 'en_cours',
  paused: 'pausee',
  completed: 'terminee',
  failed: 'echouee',
  killed: 'arretee',
};
const STATUT_NOTIFICATION: Record<string, StatutTache> = { completed: 'terminee', failed: 'echouee', stopped: 'arretee' };
const TERMINEES: ReadonlySet<StatutTache> = new Set(['terminee', 'echouee', 'arretee']);

export class RegistreTaches {
  private readonly taches = new Map<string, DetailTacheSession>();
  // Modèle demandé par chaque appel de sous-agent : l'appel le donne, la tâche le reçoit à son démarrage.
  private readonly modelesParAppel = new Map<string, string>();

  constructor(private readonly horloge: () => Date = () => new Date()) {}

  observer(msg: SDKMessage): void {
    if (msg.type === 'assistant') {
      this.retenirModeles(msg.message.content);
      return;
    }
    if (msg.type !== 'system') return;
    switch (msg.subtype) {
      case 'task_started':
        return this.demarrer(msg);
      case 'task_progress':
        return this.progresser(msg.task_id, msg.summary ?? msg.last_tool_name ?? null, msg.usage);
      case 'task_updated':
        return this.mettreAJour(msg.task_id, msg.patch);
      case 'task_notification':
        return this.terminer(msg.task_id, msg.status, msg.usage);
      case 'background_tasks_changed':
        return this.marquerArrierePlan(msg.tasks.map((tache) => tache.task_id));
      default:
        return;
    }
  }

  liste(): TacheSession[] {
    return [...this.taches.values()].map(({ prompt: _prompt, ...tache }) => tache);
  }

  detail(id: string): DetailTacheSession | null {
    const tache = this.taches.get(id);
    return tache ? { ...tache } : null;
  }

  private retenirModeles(contenu: readonly { type: string; id?: string; name?: string; input?: unknown }[]): void {
    for (const bloc of contenu) {
      if (bloc.type !== 'tool_use' || !bloc.name || !OUTILS_SOUS_AGENT.has(bloc.name) || !bloc.id) continue;
      const modele = typeof bloc.input === 'object' && bloc.input !== null ? Reflect.get(bloc.input, 'model') : undefined;
      if (typeof modele !== 'string' || !modele) continue;
      this.modelesParAppel.set(bloc.id, modele);
      if (this.modelesParAppel.size > MAX_MODELES) this.modelesParAppel.delete(this.modelesParAppel.keys().next().value ?? '');
    }
  }

  private demarrer(msg: Extract<SDKMessage, { subtype: 'task_started' }>): void {
    if (msg.ambient || msg.skip_transcript) return;
    const modele = msg.tool_use_id ? (this.modelesParAppel.get(msg.tool_use_id) ?? null) : null;
    this.taches.set(msg.task_id, {
      id: msg.task_id,
      type: msg.task_type ?? 'tache',
      description: msg.description,
      statut: 'en_cours',
      arrierePlan: msg.is_backgrounded ?? false,
      sousAgent: msg.subagent_type ?? null,
      modele,
      parent: msg.parent_task_id ?? null,
      activite: null,
      outils: 0,
      jetons: 0,
      dureeMs: 0,
      debutLe: this.maintenant(),
      finLe: null,
      prompt: msg.prompt ?? null,
    });
  }

  private progresser(id: string, activite: string | null, usage: { total_tokens: number; tool_uses: number; duration_ms: number }): void {
    this.modifier(id, (tache) => {
      if (TERMINEES.has(tache.statut)) return;
      tache.activite = activite;
      tache.outils = usage.tool_uses;
      tache.jetons = usage.total_tokens;
      tache.dureeMs = usage.duration_ms;
    });
  }

  private mettreAJour(id: string, patch: Extract<SDKMessage, { subtype: 'task_updated' }>['patch']): void {
    this.modifier(id, (tache) => {
      if (patch.description) tache.description = patch.description;
      if (patch.is_backgrounded !== undefined) tache.arrierePlan = patch.is_backgrounded;
      if (patch.status) this.fixerStatut(tache, STATUT_MISE_A_JOUR[patch.status] ?? tache.statut);
      if (typeof patch.end_time === 'number') tache.finLe = new Date(patch.end_time).toISOString();
    });
  }

  private terminer(id: string, statut: string, usage: { total_tokens: number; tool_uses: number; duration_ms: number } | undefined): void {
    this.modifier(id, (tache) => {
      this.fixerStatut(tache, STATUT_NOTIFICATION[statut] ?? tache.statut);
      if (usage) {
        tache.outils = usage.tool_uses;
        tache.jetons = usage.total_tokens;
        tache.dureeMs = usage.duration_ms;
      }
    });
    this.elaguer();
  }

  private marquerArrierePlan(ids: readonly string[]): void {
    for (const id of ids) this.modifier(id, (tache) => void (tache.arrierePlan = true));
  }

  private fixerStatut(tache: DetailTacheSession, statut: StatutTache): void {
    tache.statut = statut;
    if (TERMINEES.has(statut)) {
      tache.activite = null;
      tache.finLe ??= this.maintenant();
    }
  }

  private modifier(id: string, changer: (tache: DetailTacheSession) => void): void {
    const tache = this.taches.get(id);
    if (tache) changer(tache);
  }

  // Les tâches terminées les plus anciennes partent d'abord ; les tâches en cours ne partent jamais.
  private elaguer(): void {
    const terminees = [...this.taches.values()].filter((tache) => TERMINEES.has(tache.statut));
    for (const tache of terminees.slice(0, Math.max(0, terminees.length - MAX_TERMINEES))) this.taches.delete(tache.id);
  }

  private maintenant(): string {
    return this.horloge().toISOString();
  }
}
