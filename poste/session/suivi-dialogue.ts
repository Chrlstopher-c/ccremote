// Responsabilité : le dialogue en attente d'UNE session, relevé à l'écran de son pane, et la réponse venue de Quart,
// tapée dans le pane après avoir revérifié que ce même dialogue y est toujours affiché.
import type { Dialogue, ReponseDialogue } from '../../commun/session.ts';
import { dialogueDe, type MenuAffiche, menuAffiche, touchesReponse } from './dialogue.ts';
import * as tmux from './tmux.ts';

const PAUSE_TOUCHE_MS = 250;

export class SuiviDialogue {
  private menu: MenuAffiche | null = null;

  releverEcran(ecran: string | null): void {
    this.menu = ecran === null ? null : menuAffiche(ecran);
  }

  get courant(): Dialogue | null {
    return this.menu ? dialogueDe(this.menu) : null;
  }

  async repondre(pane: string, r: ReponseDialogue): Promise<string | null> {
    const ecran = await tmux.capturer(pane);
    const menu = ecran === null ? null : menuAffiche(ecran);
    if (!menu || dialogueDe(menu).id !== r.id) return 'ce dialogue n’est plus affiché : quelqu’un y a déjà répondu';
    const touches = touchesReponse(menu, r);
    if (typeof touches === 'string') return touches;
    for (const t of touches) {
      const res = 'texte' in t ? await tmux.taper(pane, t.texte) : await tmux.touche(pane, t.touche);
      if (res.code !== 0) return `tmux refuse la touche : ${res.erreur}`;
      await Bun.sleep(PAUSE_TOUCHE_MS);
    }
    this.menu = null;
    return null;
  }
}
