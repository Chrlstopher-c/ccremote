// Responsabilité : les sessions du poste (transcripts) pas encore ouvertes dans Lanterne — leur liste pour le
// relais, leur import en fiche fermée reprenable, et la copie d'une session. Le repérage est dans `decouverte.ts`.
import type { Logger } from 'pino';
import type { Decouverte } from '../../commun/decouverte.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { ConfigPoste } from '../config.ts';
import { IndexDecouvertes, type TranscriptDecouvert } from './decouverte.ts';
import { conversationsVivantes } from './processus.ts';
import type { SessionPersistee } from './persistance.ts';
import { fichePourIdentifiant } from './identifiants-fiche.ts';
import { ficheImportee } from './importation.ts';
import { recalerFiche, sourcesDe } from './recalage-fiche.ts';
import type { SessionPoste } from './session-poste.ts';
import { SessionsSupprimees } from './suppression.ts';
import { HISTORIQUE_ADOPTION, origineDe } from './balayage-sessions.ts';

export interface DependancesImportation {
  readonly config: ConfigPoste;
  readonly journal: Logger;
  readonly decouvertes: IndexDecouvertes;
  readonly sessions: Map<string, SessionPoste>;
  readonly supprimees: SessionsSupprimees;
  readonly creer: (p: SessionPersistee) => SessionPoste;
  readonly configDirs: () => (string | null)[];
  readonly annoncer: () => void;
  readonly sauvegarder: () => void;
  readonly publier: (r: ResumeSession) => void;
}

// Le chemin du transcript et son dossier de configuration restent sur le poste : le relais ne voit que la session.
function sansChemin(t: TranscriptDecouvert): Decouverte {
  const { chemin: _chemin, configDir: _configDir, ...decouverte } = t;
  return decouverte;
}

export class ImportationSessions {
  constructor(private readonly d: DependancesImportation) {}

  // Sessions du poste pas encore ouvertes, sans les identifiants supprimés par Chris ; une session tenue par un
  // processus Claude est marquée `vivante`.
  listeDecouvertes(): Decouverte[] {
    const vivantes = conversationsVivantes(this.d.configDirs(), this.d.journal);
    return this.d.decouvertes
      .liste((id) => this.fichePour(id) !== undefined || this.d.supprimees.has(id))
      .map((t) => ({ ...sansChemin(t), ...(vivantes.has(t.id) ? { vivante: true } : {}) }));
  }

  // Une session qui tourne en ce moment (processus Claude Code) n'est pas à importer : elle s'écrit encore.
  trouverImportables(): TranscriptDecouvert[] {
    const vivantes = conversationsVivantes(this.d.configDirs(), this.d.journal);
    return this.d.decouvertes.liste(
      (id) => this.fichePour(id) !== undefined || this.d.supprimees.has(id) || vivantes.has(id),
    );
  }

  // Ouverture des sessions découvertes choisies : fiches fermées, reprenables par le SDK ; historique du transcript.
  importer(ids: readonly string[]): { importees: number; absentes: string[] } {
    const trouves = this.trouverImportables();
    const aImporter = trouves.filter((t) => ids.includes(t.id));
    const absentes = ids.filter((id) => !aImporter.some((t) => t.id === id));
    for (const t of aImporter) this.importerUne(t);
    this.d.sauvegarder();
    this.d.annoncer();
    return { importees: aImporter.length, absentes };
  }

  // `invite` : copie d'une session d'invité, qui garde son cadre (configuration, espace, relais).
  importerUne(
    t: TranscriptDecouvert,
    surcharge: Partial<ResumeSession> = {},
    consignes: string | null = null,
    invite?: SessionPersistee['invite'],
  ): void {
    const fiche = recalerFiche(ficheImportee(origineDe(this.d.config), t), sourcesDe(t.chemin, t.id, this.d.journal));
    const session = this.d.creer({
      resume: { ...fiche, ...surcharge },
      consignes,
      configDir: t.configDir,
      ...(invite ? { invite } : {}),
      transcript: t.chemin,
      position: 0,
      aReprendre: false,
    });
    this.d.sessions.set(t.id, session);
    session.definirTranscript(t.chemin, HISTORIQUE_ADOPTION, t.id);
    this.d.publier(session.resume);
  }

  // La fiche d'un identifiant : sa clé, son identifiant courant ou un identifiant SDK passé (rembobinage).
  private fichePour(id: string): SessionPoste | undefined {
    return fichePourIdentifiant(this.d.sessions.values(), id);
  }
}
