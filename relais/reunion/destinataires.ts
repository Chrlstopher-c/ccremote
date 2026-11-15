// Responsabilité : qui reçoit une demande de Chris. Routage « auto » v1 : pertinence simple, sans appel de modèle (le
// Pi n'en fait pas). POINT D'EXTENSION : un routage Haiku exécuté sur un poste remplacera `RouteurAuto` sans rien
// toucher d'autre. Pur : aucune I/O.
import type { ResumeSession } from '../../commun/session.ts';

// Reçoit le texte de la demande et les sessions actives ; rend les sessionIds concernés.
export type RouteurAuto = (texte: string, actives: readonly ResumeSession[]) => readonly string[];

// Un mot du titre compte à partir de 4 lettres, un nom de projet à partir de 3 : en deçà, il se trouve dans presque
// tout message et ne désigne rien.
const MOT_TITRE_MIN = 4;
const NOM_PROJET_MIN = 3;

// Actives = ni fermée ni rangée. Seules les sessions principales figurent ici : les sous-agents n'ont pas de fiche.
export function sessionsActives(sessions: readonly ResumeSession[]): ResumeSession[] {
  return sessions.filter((s) => s.statut !== 'fermee' && s.archivee !== true);
}

export const routerParPertinence: RouteurAuto = (texte, actives) => {
  const message = texte.toLocaleLowerCase('fr');
  const mentionnees = actives.filter((s) => mentionne(message, s));
  return (mentionnees.length > 0 ? mentionnees : actives).map((s) => s.id);
};

// Le projet est nommé, ou un mot du titre apparaît dans le message (« facturation » pour « Facturation mensuelle »).
function mentionne(message: string, session: ResumeSession): boolean {
  const projet = session.projet.nom.toLocaleLowerCase('fr');
  const motsTitre = session.titre
    .toLocaleLowerCase('fr')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((mot) => mot.length >= MOT_TITRE_MIN);
  const projetNomme = projet.length >= NOM_PROJET_MIN && message.includes(projet);
  return projetNomme || motsTitre.some((mot) => message.includes(mot));
}

// Le routeur ne peut désigner que des sessions actives : tout autre identifiant est écarté.
export function choisirAuto(
  texte: string,
  sessions: readonly ResumeSession[],
  routeur: RouteurAuto = routerParPertinence,
): string[] {
  const actives = sessionsActives(sessions);
  const admis = new Set(actives.map((s) => s.id));
  return routeur(texte, actives).filter((id) => admis.has(id));
}
