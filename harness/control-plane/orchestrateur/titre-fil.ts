/**
 * Responsabilité : qui a le droit de nommer un fil, et quand.
 *
 * L'orchestrateur nomme le fil UNE fois — au deuxième message de Chris, quand le
 * sujet est établi — puis n'y touche plus de la session. Chris, lui, renomme
 * quand il veut, depuis l'interface ou en le demandant dans la conversation.
 *
 * `☠` La règle vit ici, pas dans le prompt. « Ne retouche plus le titre » écrit
 * dans un mandat est une intention : au bout de trente tours, un modèle qui
 * trouve un meilleur titre le pose, et le fil que Chris cherchait dans sa liste a
 * changé de nom sans que personne l'ait décidé. La borne mécanique est ce qui
 * fait la différence entre une consigne et une garantie.
 */

export const TITRE_PAR_DEFAUT = 'Nouvelle conversation';
export const TITRE_MAX = 80;

/**
 * Nombre de messages de Chris avant qu'un nommage automatique soit permis.
 *
 * `☠` Deux, pas un : un fil nommé sur la première phrase porte le titre de la
 * question d'ouverture, pas celui du sujet — et ce titre-là reste toute la
 * session. Le deuxième message est le premier moment où le fil a un sujet.
 */
export const MESSAGES_AVANT_NOMMAGE = 2;

export type SourceTitre = 'defaut' | 'auto' | 'manuel';

export interface EtatFilPourNommage {
  readonly source: SourceTitre;
  /** Messages de Chris déjà présents dans le fil, celui en cours compris. */
  readonly messagesOperateur: number;
}

/**
 * Rappel joint au message de Chris tant que le fil n'a pas de titre.
 *
 * `☠` Mesuré le 01/08 : la consigne existait dans le mandat, l'outil était
 * exposé, et l'orchestrateur n'a nommé aucun fil — absorbé par la question, il
 * ne relit pas une ligne perdue au milieu de deux cents. Une consigne qui
 * n'arrive pas AU MOMENT où elle s'applique n'est pas une consigne.
 *
 * Il n'est jamais écrit au registre : le fil affiché à l'écran ne montre que ce
 * que Chris a réellement tapé (H-66). Et il disparaît de lui-même dès que le
 * titre existe — un rappel qui persisterait après coup pousserait au renommage,
 * l'exact contraire de ce qu'on veut.
 */
export const CONSIGNE_NOMMAGE =
  '[HARNESS] Ce fil n’a pas encore de titre. Dans ce tour, appelle `nommer_fil` avec trois à six '
  + 'mots qui disent le sujet de la conversation. Une seule fois : ce sera son titre pour toute la '
  + 'session. N’en parle pas dans ta réponse.';

/** Le rappel à joindre, ou `null` s'il n'y a rien à rappeler. */
export function consigneNommage(etat: EtatFilPourNommage): string | null {
  if (etat.source !== 'defaut') return null;
  if (etat.messagesOperateur < MESSAGES_AVANT_NOMMAGE) return null;
  return CONSIGNE_NOMMAGE;
}

export interface VerdictNommage {
  readonly ok: boolean;
  readonly raison?: string;
  readonly titre?: string;
}

/**
 * Met un titre proposé en forme. Les modèles écrivent volontiers
 * « "Titre" », « Titre : », ou une phrase entière — on garde le sens, pas la
 * ponctuation d'emballage.
 */
export function normaliserTitre(brut: string): string {
  return String(brut ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'«»\s]+|["'«»\s:.-]+$/g, '')
    .trim()
    .slice(0, TITRE_MAX)
    .trim();
}

/**
 * Le fil peut-il recevoir ce titre ?
 *
 * `☠` Chaque refus NOMME la condition à remplir. Le destinataire est un modèle :
 * il se corrige à partir d'une consigne actionnable, jamais d'un échec nu — un
 * refus muet le fait simplement recommencer au tour suivant.
 */
export function verdictNommage(
  etat: EtatFilPourNommage,
  titreBrut: string,
  demandeParChris: boolean,
): VerdictNommage {
  const titre = normaliserTitre(titreBrut);
  if (titre.length === 0) {
    return { ok: false, raison: 'le titre est vide une fois nettoyé — donne trois à six mots qui disent le sujet' };
  }
  if (titre.toLowerCase() === TITRE_PAR_DEFAUT.toLowerCase()) {
    return { ok: false, raison: `« ${TITRE_PAR_DEFAUT} » est le libellé d'attente, pas un titre — nomme le sujet réel` };
  }

  // Une demande explicite de Chris passe toujours : c'est lui qui décide du nom
  // de ses fils, y compris pour défaire un titre automatique qui lui déplaît.
  if (demandeParChris) return { ok: true, titre };

  if (etat.source !== 'defaut') {
    return {
      ok: false,
      raison:
        'ce fil porte déjà un titre et tu ne le renommes pas de ton propre chef. '
        + 'Si Chris te demande explicitement de le renommer, rappelle cet outil avec `demande_par_chris: true`',
    };
  }
  if (etat.messagesOperateur < MESSAGES_AVANT_NOMMAGE) {
    return {
      ok: false,
      raison:
        `attends le ${MESSAGES_AVANT_NOMMAGE}e message de Chris avant de nommer ce fil `
        + '— sur une seule phrase, le titre décrit la question d’ouverture et pas le sujet, et il reste toute la session',
    };
  }
  return { ok: true, titre };
}
