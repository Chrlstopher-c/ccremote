// Responsabilité : donner aux fonctions de session du SDK (lecture des messages, copie) les transcripts d'une
// configuration Claude dédiée — celle du cadre d'un invité ou d'un autre compte. Sans cela, le SDK ne cherche que
// dans la configuration du processus du poste (CLAUDE_CONFIG_DIR ou ~/.claude) : rembobiner et dupliquer une session
// d'invité échouaient (« message introuvable », « Session … not found »).
import type { SessionKey, SessionStore, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function nomFichier(cle: SessionKey): string {
  return cle.subpath ? join(cle.sessionId, `${cle.subpath}.jsonl`) : `${cle.sessionId}.jsonl`;
}

// Le dossier de projet attendu d'abord ; sinon celui qui contient ce transcript (nommage différent selon le système).
function trouver(projets: string, cle: SessionKey): string | null {
  const attendu = join(projets, cle.projectKey, nomFichier(cle));
  if (existsSync(attendu)) return attendu;
  if (!existsSync(projets)) return null;
  for (const dossier of readdirSync(projets)) {
    const chemin = join(projets, dossier, nomFichier(cle));
    if (existsSync(chemin)) return chemin;
  }
  return null;
}

function lire(chemin: string): SessionStoreEntry[] {
  return readFileSync(chemin, 'utf8')
    .split('\n')
    .flatMap((ligne) => {
      try {
        return ligne ? [JSON.parse(ligne) as SessionStoreEntry] : [];
      } catch {
        return []; // ligne coupée en cours d'écriture : ignorée
      }
    });
}

/** Chemin du transcript principal d'une conversation dans cette configuration ; null s'il n'y est pas. */
export function cheminDansConfig(configDir: string, cwdProjet: string, sessionId: string): string | null {
  return trouver(join(configDir, 'projects'), { projectKey: cwdProjet.replace(/[^A-Za-z0-9]/g, '-'), sessionId });
}

/** Magasin du SDK adossé aux fichiers d'une configuration Claude : mêmes chemins que ceux de Claude Code. */
export function magasinDeConfig(configDir: string): SessionStore {
  const projets = join(configDir, 'projects');
  return {
    load: async (cle) => {
      const chemin = trouver(projets, cle);
      return chemin ? lire(chemin) : null;
    },
    append: async (cle, entrees) => {
      const chemin = join(projets, cle.projectKey, nomFichier(cle));
      mkdirSync(join(chemin, '..'), { recursive: true });
      appendFileSync(chemin, entrees.map((e) => `${JSON.stringify(e)}\n`).join(''));
    },
  };
}

/** Option à ajouter aux appels de session du SDK ; rien pour la configuration par défaut du poste. */
export function optionsMagasin(configDir: string | null): { sessionStore?: SessionStore } {
  return configDir ? { sessionStore: magasinDeConfig(configDir) } : {};
}
