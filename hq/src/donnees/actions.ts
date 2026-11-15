// Responsabilité : les actions de Chris sur une session (envoyer, répondre, interrompre, compacter, éteindre,
// reprendre, archiver). Chacune passe par l'API de la source et rend un résultat : l'interface ne lève jamais.
import type { ActionSession, ReponseDialogue } from './contrat';
import { journaliser } from './journal';
import type { ApiMonde } from './source-monde';

export type ResultatAction = { readonly ok: true } | { readonly ok: false; readonly erreur: string };

export interface ActionsMonde {
  envoyer(sessionId: string, texte: string): Promise<ResultatAction>;
  repondre(sessionId: string, reponse: ReponseDialogue): Promise<ResultatAction>;
  interrompre(sessionId: string): Promise<ResultatAction>;
  compacter(sessionId: string): Promise<ResultatAction>;
  // Éteindre une session = la fermer : plus de processus, elle reste reprenable.
  eteindre(sessionId: string): Promise<ResultatAction>;
  reprendre(sessionId: string): Promise<ResultatAction>;
  archiver(sessionId: string): Promise<ResultatAction>;
  desarchiver(sessionId: string): Promise<ResultatAction>;
}

const MESSAGE_VIDE: ResultatAction = { ok: false, erreur: 'message vide' };

export function creerActions(api: ApiMonde): ActionsMonde {
  const agir = (action: ActionSession, sessionId: string): Promise<ResultatAction> =>
    executer(action, sessionId, () => api.agir(sessionId, action));
  return {
    envoyer: (sessionId, texte) =>
      texte.trim() === ''
        ? Promise.resolve(MESSAGE_VIDE)
        : executer('envoyer', sessionId, () => api.envoyerMessage(sessionId, texte)),
    repondre: (sessionId, reponse) => executer('repondre', sessionId, () => api.repondre(sessionId, reponse)),
    interrompre: (sessionId) => agir('interrompre', sessionId),
    compacter: (sessionId) => agir('compacter', sessionId),
    eteindre: (sessionId) => agir('fermer', sessionId),
    reprendre: (sessionId) => agir('reprendre', sessionId),
    archiver: (sessionId) => agir('archiver', sessionId),
    desarchiver: (sessionId) => agir('desarchiver', sessionId),
  };
}

async function executer(
  action: string,
  sessionId: string,
  operation: () => Promise<void>,
): Promise<ResultatAction> {
  try {
    await operation();
    return { ok: true };
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    journaliser('warn', `action « ${action} » refusée`, { sessionId, erreur: message });
    return { ok: false, erreur: message };
  }
}
