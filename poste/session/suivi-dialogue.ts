// Responsabilité : le dialogue en attente d'UNE session — AskUserQuestion lu dans le transcript, ou menu relevé à
// l'écran — et la réponse venue de Quart, tapée dans le pane après avoir vérifié que le dialogue y est toujours.
import type { Dialogue, ReponseDialogue } from '../../commun/session.ts';
import {
  dialogueChoix,
  type MenuAffiche,
  menuAffiche,
  questionsDe,
  resultatsDe,
  type Touche,
  touchesChoix,
  touchesQuestions,
} from './dialogue.ts';
import * as tmux from './tmux.ts';
import type { Ligne } from './traduction.ts';

type DialogueQuestions = Extract<Dialogue, { genre: 'questions' }>;

const PAUSE_TOUCHE_MS = 250;
const DEBUT_QUESTION = 30;

export class SuiviDialogue {
  private question: DialogueQuestions | null = null;
  private menu: MenuAffiche | null = null;

  absorber(l: Ligne): void {
    const posees = questionsDe(l);
    if (posees.length > 0) this.question = posees.at(-1) ?? null;
    if (this.question && resultatsDe(l).includes(this.question.id)) this.question = null;
  }

  /** Un AskUserQuestion prime : son dialogue à l'écran est connu en détail par le transcript. */
  releverEcran(ecran: string | null): void {
    this.menu = this.question || ecran === null ? null : menuAffiche(ecran);
  }

  get courant(): Dialogue | null {
    if (this.question) return this.question;
    return this.menu ? dialogueChoix(this.menu) : null;
  }

  async repondre(pane: string, r: ReponseDialogue): Promise<string | null> {
    const ecran = await tmux.capturer(pane);
    if (ecran === null) return 'pane illisible';
    const touches = this.touches(ecran, r);
    if (typeof touches === 'string') return touches;
    for (const t of touches) {
      const res = 'texte' in t ? await tmux.taper(pane, t.texte) : await tmux.touche(pane, t.touche);
      if (res.code !== 0) return `tmux refuse la touche : ${res.erreur}`;
      await Bun.sleep(PAUSE_TOUCHE_MS);
    }
    this.menu = null;
    return null;
  }

  // On ne tape rien sans avoir revu, à l'écran, le dialogue auquel la réponse s'adresse.
  private touches(ecran: string, r: ReponseDialogue): Touche[] | string {
    const obsolete = 'ce dialogue n’est plus affiché : quelqu’un y a déjà répondu';
    if (r.genre === 'questions') {
      const q = this.question;
      const debut = q?.questions[0]?.question.slice(0, DEBUT_QUESTION) ?? '';
      if (!q || q.id !== r.id || !ecran.includes(debut) || menuAffiche(ecran) === null) return obsolete;
      return touchesQuestions(q.questions, r);
    }
    const menu = menuAffiche(ecran);
    if (!menu || dialogueChoix(menu).id !== r.id) return obsolete;
    return touchesChoix(menu, r.index);
  }
}
