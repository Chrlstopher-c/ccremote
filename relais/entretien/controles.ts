// Responsabilité : les contrôles d'une machine (liaison, poste, version, compte) — des faits en entrée, une phrase
// française courte et une action proposée en sortie. Pur. Jamais d'hôte, d'adresse, de port ni d'utilisateur.
import type { EtatAccesMachine } from '../../commun/api-clients.ts';

export type ActionControle =
  'reparer_liaison' | 'mettre_a_jour' | 'reveiller' | 'reconnecter_compte' | 'arreter_moteur_orphelin' | null;

export interface Controle {
  readonly id: string;
  readonly ok: boolean;
  readonly phrase: string;
  readonly action: ActionControle;
}

export interface EntreeControles {
  readonly locale: boolean;
  readonly enLigne: boolean;
  readonly installee: boolean;
  readonly acces: { readonly etat: EtatAccesMachine; readonly detail: string | null } | null;
  readonly reveilPossible: boolean;
  readonly aJour: boolean | null;
  readonly comptesConnectes: number;
}

/** La phrase du détail d'accès quand le port distant de la liaison est déjà utilisé (voir tunnels.ts). */
export const PORT_DISTANT_PRIS = 'port distant déjà pris';

const ok = (id: string, phrase: string): Controle => ({ id, ok: true, phrase, action: null });
const ko = (id: string, phrase: string, action: ActionControle = null): Controle => ({ id, ok: false, phrase, action });

function liaison(e: EntreeControles): Controle {
  const acces = e.acces;
  if (e.locale) return ok('liaison', 'Poste local, pas de liaison.');
  if (!acces || acces.etat === 'non_installe') return ok('liaison', 'Pas de liaison : poste non installé.');
  if (acces.etat === 'connecte') return ok('liaison', 'Liaison ouverte.');
  if (acces.detail?.startsWith(PORT_DISTANT_PRIS)) {
    return ko('liaison', 'Le port de la liaison est déjà pris sur la machine.', 'reparer_liaison');
  }
  if (acces.etat === 'connexion') return ko('liaison', 'La liaison est ouverte, le poste n’a pas encore répondu.');
  return ko('liaison', `La liaison ne passe pas : ${acces.detail ?? 'cause inconnue'}.`);
}

function poste(e: EntreeControles): Controle {
  if (e.locale) return ok('poste', 'Poste local.');
  if (!e.installee) return ko('poste', 'Poste non installé.');
  if (e.enLigne) return ok('poste', 'Poste connecté.');
  if (e.reveilPossible) return ko('poste', 'Machine éteinte ou hors ligne.', 'reveiller');
  return ko('poste', 'Poste hors ligne.');
}

function version(e: EntreeControles): Controle {
  if (e.locale) return ok('version', 'Même version que l’appli.');
  if (e.aJour === false) return ko('version', 'Le poste n’est pas à la version de l’appli.', 'mettre_a_jour');
  if (e.aJour === true) return ok('version', 'À la version de l’appli.');
  return ok('version', 'Version non comparée.');
}

function compte(e: EntreeControles): Controle {
  if (!e.enLigne) return ok('compte', 'Compte non relevé : poste hors ligne.');
  if (e.comptesConnectes === 0) return ko('compte', 'Aucun compte Claude connecté.', 'reconnecter_compte');
  return ok('compte', 'Compte Claude connecté.');
}

/** Les quatre contrôles d'une machine, dans l'ordre d'affichage. */
export function controlesMachine(e: EntreeControles): Controle[] {
  return [liaison(e), poste(e), version(e), compte(e)];
}
