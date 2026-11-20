// Responsabilité : exécuter sur le poste les commandes du lot 2 de la vague « reste » (compactions, fusion, dictée,
// tâches planifiées). Chaque commande passe par son module ; rien n'est écrit ici hors des tâches planifiées.
import type { Logger } from 'pino';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import { GENRES_RESTE_LOT2 } from '../../commun/reste-lot2.ts';
import type { Reponse } from '../session/gestionnaire.ts';
import { lireResumesCompaction } from './compactions.ts';
import { etatDictee, transcrire } from './dictee.ts';
import { dossierDeTravail } from '../parite/depot.ts';
import { creerFusion, etatFusion } from './fusion.ts';
import type { ServiceTaches } from './taches-planifiees.ts';

export type CommandeResteLot2 = Extract<CommandeRelais, { kind: (typeof GENRES_RESTE_LOT2)[number] }>;

/** Ce que le lot 2 touche du poste : une session (dossier et transcript), les tâches, le socket de dictée. */
export interface ContexteResteLot2 {
  readonly session: (id: string) => { readonly cwd: string; readonly transcript: string | null } | null;
  readonly taches: Pick<ServiceTaches, 'lister' | 'enregistrer' | 'supprimer' | 'executer'>;
  readonly socketDictee: () => string;
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
      const corps = { titre: c.titre, corps: c.corps, brouillon: c.brouillon };
      const donnees = s
        ? await creerFusion(await dossierDeTravail(s.cwd, s.transcript, x.journal), corps, x.journal)
        : { etat: 'erreur', raison: 'session inconnue sur ce poste' };
      return { ok: true, donnees };
    }
    case 'dictee_etat':
      return { ok: true, donnees: await etatDictee(x.socketDictee(), x.journal) };
    case 'dictee_transcrire':
      return { ok: true, donnees: await transcrire(x.socketDictee(), c.pcm16, c.langue, x.journal) };
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
