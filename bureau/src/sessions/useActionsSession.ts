// Responsabilité : les actions de Chris sur une session, avec l'erreur éventuelle à afficher.
import { useCallback, useState } from 'react';
import type { ActionSession } from '../../../commun/api-clients.ts';
import type { ReponseDialogue, ResumeSession } from '../../../commun/session.ts';
import { ErreurApi } from '../shared/api/client.ts';
import { useEtat, useMagasin } from '../shared/etat/contexte.tsx';
import { ouvrirTerminal } from '../shared/natif.ts';

async function kitty(session: ResumeSession, utilisateur: string | undefined): Promise<void> {
  if (!session.tmux) throw new Error('session fermée : reprends-la d’abord');
  const refus = await ouvrirTerminal(session.machine, session.tmux, utilisateur);
  if (refus) throw new Error(refus);
}

export function useActionsSession(session: ResumeSession) {
  const { client } = useMagasin();
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const utilisateur = useEtat((e) => e.machines.find((m) => m.id === session.machine)?.etat?.utilisateur);

  const executer = useCallback(async (f: () => Promise<unknown>): Promise<boolean> => {
    setOccupe(true);
    setErreur(null);
    try {
      await f();
      return true;
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : String(e));
      return false;
    } finally {
      setOccupe(false);
    }
  }, []);

  return {
    erreur,
    occupe,
    effacerErreur: () => setErreur(null),
    envoyer: (texte: string) => executer(() => client.envoyer(session.id, texte)),
    agir: (a: ActionSession) => executer(() => client.agir(session.id, a)),
    repondre: (r: ReponseDialogue) => executer(() => client.repondre(session.id, r)),
    autonomie: (active: boolean) => executer(() => client.autonomie(session.id, active)),
    terminal: () => executer(() => kitty(session, utilisateur)),
  };
}
