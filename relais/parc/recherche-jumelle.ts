// Responsabilité : trouver la session de poste qui tient la même conversation qu'une session Remote Control (claude.ai)
// et lui rendre la machine et le dossier réels. Les recherches dans les événements sont gardées en cache ; un échec est
// retenté au plus une fois par minute.
import type { Decouverte } from '../../commun/decouverte.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { Registre } from '../registre/registre.ts';
import { avecDecouverteJumelle, avecJumelleReelle } from './jumelle-distante.ts';

const ESSAI_JUMELLE_MS = 60_000; // une jumelle Remote Control introuvable est recherchée de nouveau après ce délai

export class RechercheJumelle {
  private readonly essais = new Map<string, { jumelle: string | null; essai: number }>();

  constructor(
    private readonly registre: Registre,
    private readonly decouverteDuPont: (id: string) => Decouverte | null,
  ) {}

  /** Session Remote Control (claude.ai) qui est la même conversation qu'une session de poste (Desktop sur la tour) :
   * les deux fils partagent les uuid des lignes du transcript. Sa `conversation` devient celle du poste, ce qui la
   * rattache à sa jumelle dans la liste. */
  avecJumelle(s: ResumeSession): ResumeSession {
    if (!s.distant || !s.id.startsWith('cse_')) return s;
    const parPont = this.decouverteDuPont(s.id);
    // Conversation déjà ouverte par un poste : sa fiche dit la vraie machine (le transcript peut exister ailleurs).
    const ouverte = parPont ? this.registre.session(parPont.id) : null;
    if (ouverte && !ouverte.distant) return avecJumelleReelle(s, ouverte);
    if (parPont) return avecDecouverteJumelle(s, parPont);
    return avecJumelleReelle(s, this.jumelleTrouvee(s));
  }

  private jumelleTrouvee(s: ResumeSession): ResumeSession | null {
    const connu = this.essais.get(s.id);
    let jumelle = connu?.jumelle ?? null;
    if (!jumelle && (!connu || Date.now() - connu.essai > ESSAI_JUMELLE_MS)) {
      const uuids = this.registre
        .derniersEvenements(s.id, 200)
        .map((e) => {
          const evt = e.evt as { type: string; uuid?: unknown; id?: unknown };
          return evt.type === 'outil' ? evt.id : evt.uuid;
        })
        .filter((u): u is string => typeof u === 'string' && u !== '');
      jumelle = this.registre.sessionPartageantUuid(uuids, s.id);
      this.essais.set(s.id, { jumelle, essai: Date.now() });
    }
    return jumelle ? this.registre.session(jumelle) : null;
  }
}
