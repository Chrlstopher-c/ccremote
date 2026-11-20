// Responsabilité : exécuter sur le poste les commandes du lot 2 de la vague « reste » (compactions, fusion, dictée,
// tâches planifiées). Chaque commande passe par son module ; rien n'est écrit ici hors des tâches planifiées.
import type { Logger } from 'pino';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import { GENRES_RESTE_LOT2 } from '../../commun/reste-lot2.ts';
import type { Reponse } from '../session/gestionnaire.ts';
import { lireResumesCompaction } from './compactions.ts';
import { etatDictee, transcrire } from './dictee.ts';
import { dossierDeTravail } from '../parite/depot.ts';
import type { ServiceMoteurDictee } from './dictee-service.ts';
import { creerFusion, etatFusion } from './fusion.ts';
import type { ServiceTaches } from './taches-planifiees.ts';

export type CommandeResteLot2 = Extract<CommandeRelais, { kind: (typeof GENRES_RESTE_LOT2)[number] }>;
type CommandeDictee = Extract<
  CommandeResteLot2,
  { kind: 'dictee_etat' | 'dictee_transcrire' | 'dictee_service_etat' | 'dictee_service' }
>;

/** Ce que le lot 2 touche du poste : une session, les tâches, le socket de dictée et le service de dictée. */
export interface ContexteResteLot2 {
  readonly session: (id: string) => { readonly cwd: string; readonly transcript: string | null } | null;
  readonly taches: Pick<ServiceTaches, 'lister' | 'enregistrer' | 'supprimer' | 'executer'>;
  readonly socketDictee: () => string;
  readonly dicteeService: Pick<ServiceMoteurDictee, 'etat' | 'piloter' | 'noterTranscription'>;
  readonly journal: Logger;
}

export function estResteLot2(c: CommandeRelais): c is CommandeResteLot2 {
  return (GENRES_RESTE_LOT2 as readonly string[]).includes(c.kind);
}

export async function executerResteLot2(c: CommandeResteLot2, x: ContexteResteLot2): Promise<Reponse> {
  switch (c.kind) {
    case 'compactions': {
      const transcript = x.session(c.sessionId)?.transcript ?? null;
      return { ok: true, donnees: { resumes: lireResumesCompaction(transcript, x.journal) } };
    }
    case 'pr_etat': {
      const s = x.session(c.sessionId);
      const donnees = s
        ? await etatFusion(await dossierDeTravail(s.cwd, s.transcript, x.journal), x.journal)
        : { etat: 'absente', raison: 'session inconnue sur ce poste' };
      return { ok: true, donnees };
    }
    case 'pr_creer': {
      const s = x.session(c.sessionId);
      const donnees = s
        ? await creerFusion(
            await dossierDeTravail(s.cwd, s.transcript, x.journal),
            { titre: c.titre, corps: c.corps, brouillon: c.brouillon },
            x.journal,
          )
        : { etat: 'erreur', raison: 'session inconnue sur ce poste' };
      return { ok: true, donnees };
    }
    case 'dictee_etat':
    case 'dictee_transcrire':
    case 'dictee_service_etat':
    case 'dictee_service':
      return executerDictee(c, x);
    case 'taches_lister':
      return x.taches.lister();
    case 'tache_enregistrer':
      return x.taches.enregistrer(c.tache, c.corps);
    case 'tache_supprimer':
      return x.taches.supprimer(c.tache);
    case 'tache_executer':
      return x.taches.executer(c.tache);
  }
}

// La dictée : le démon (transcription, état du socket) et le service de son moteur (état, démarrer, arrêter, régler).
async function executerDictee(c: CommandeDictee, x: ContexteResteLot2): Promise<Reponse> {
  switch (c.kind) {
    case 'dictee_etat':
      return { ok: true, donnees: await etatDictee(x.socketDictee(), x.journal) };
    case 'dictee_transcrire': {
      const r = await transcrire(x.socketDictee(), c.pcm16, c.langue, x.journal);
      if (r.etat === 'ok') x.dicteeService.noterTranscription(r.ms);
      return { ok: true, donnees: r };
    }
    case 'dictee_service_etat':
      return { ok: true, donnees: await x.dicteeService.etat() };
    case 'dictee_service': {
      const r = await x.dicteeService.piloter(c.action, c.arretInactiviteMin);
      return r.ok ? { ok: true, donnees: r.etat } : { ok: false, erreur: r.erreur };
    }
  }
}
