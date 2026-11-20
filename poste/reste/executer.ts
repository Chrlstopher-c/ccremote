// Responsabilité : exécuter sur le poste les commandes de la vague « reste » reçues du relais (recherche dans les
// transcripts, mémoire Hippocampe, commandes Claude). Lecture seule, sauf la création d'une commande.
import type { Logger } from 'pino';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import { GENRES_RESTE } from '../../commun/reste.ts';
import type { Reponse } from '../session/gestionnaire.ts';
import { creerCommande, listerCommandes } from './commandes-claude.ts';
import { lireMemoire } from './memoire.ts';
import { rechercherTranscripts } from './recherche-transcripts.ts';

export type CommandeReste = Extract<CommandeRelais, { kind: (typeof GENRES_RESTE)[number] }>;

export interface ContexteReste {
  /** Dossiers `projects` des configurations Claude du poste. */
  readonly racines: () => readonly string[];
  /** Dossier de configuration Claude de la machine (`~/.claude` par défaut). */
  readonly dossierConfig: string;
  /** Fichier `.claude.json` qui porte la configuration du serveur Hippocampe. */
  readonly fichierClaudeJson: string;
  readonly journal: Logger;
}

export function estReste(c: CommandeRelais): c is CommandeReste {
  return (GENRES_RESTE as readonly string[]).includes(c.kind);
}

export async function executerReste(c: CommandeReste, x: ContexteReste): Promise<Reponse> {
  switch (c.kind) {
    case 'rechercher_transcripts':
      return {
        ok: true,
        donnees: await rechercherTranscripts(c.texte, c.limite, { racines: x.racines(), journal: x.journal }),
      };
    case 'memoire_lire':
      return { ok: true, donnees: await lireMemoire(c, x.fichierClaudeJson, x.journal) };
    case 'commandes_lister':
      return { ok: true, donnees: { commandes: listerCommandes(x.dossierConfig, x.journal) } };
    case 'commande_creer': {
      const r = creerCommande(x.dossierConfig, c, x.journal);
      return r.ok ? { ok: true, donnees: { nom: r.nom } } : { ok: false, erreur: r.erreur };
    }
  }
}
