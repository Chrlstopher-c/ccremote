// Responsabilité : le flux SSE d'UNE session claude.ai — lecture des trames, reprise après coupure avec délai
// croissant (depuis le dernier numéro reçu), coupure si le flux se tait. Un refus durable (401, 403, 404) l'arrête
// sans reprise : l'appelant revient au sondage. Rien n'est persisté ; le jeton est relu à chaque ouverture.
import type { Logger } from 'pino';
import { ouvrirFlux } from './client-claude-ai.ts';

export interface TrameSse {
  readonly event: string;
  readonly id: number | null;
  readonly data: string;
}

export interface DependancesFlux {
  readonly configDir: string | null;
  readonly idSession: string;
  readonly journal: Logger;
  /** Dernier numéro de séquence connu : la reprise part de là (sans lui, le flux rejoue sa fenêtre entière). */
  readonly depuis: number | null;
  readonly surTrame: (trame: TrameSse) => void;
  readonly surRefus: (statut: number) => void;
  readonly delaiBaseMs?: number;
  readonly delaiMaxMs?: number;
  readonly silenceMs?: number;
}

const DELAI_BASE_MS = 1_000;
const DELAI_MAX_MS = 30_000;
const SILENCE_MS = 45_000; // aucun octet pendant ce temps : le flux est supposé mort, reprise
const REFUS_DURABLES = new Set([401, 403, 404]);

function numeroDeTrame(valeur: string): number | null {
  return /^\d+$/.test(valeur) ? Number(valeur) : null;
}

// Un bloc SSE : `event`, `id`, `data` (lignes multiples réunies par un saut de ligne) ; les commentaires (`:`) sont
// ignorés. Un bloc sans `data` (keepalive) ne produit pas de trame.
function lireBloc(bloc: string): TrameSse | null {
  let event = 'message';
  let id: number | null = null;
  const donnees: string[] = [];
  for (const ligne of bloc.split('\n')) {
    if (ligne === '' || ligne.startsWith(':')) continue;
    const deux = ligne.indexOf(':');
    const champ = deux === -1 ? ligne : ligne.slice(0, deux);
    const valeur = deux === -1 ? '' : ligne.slice(deux + 1).replace(/^ /, '');
    if (champ === 'event') event = valeur;
    else if (champ === 'id') id = numeroDeTrame(valeur);
    else if (champ === 'data') donnees.push(valeur);
  }
  return donnees.length === 0 ? null : { event, id, data: donnees.join('\n') };
}

/** Les trames complètes d'un tampon, et le reste (début d'une trame non finie). */
export function lireTrames(tampon: string): { readonly trames: TrameSse[]; readonly reste: string } {
  const texte = tampon.replace(/\r\n/g, '\n');
  const trames: TrameSse[] = [];
  let debut = 0;
  let fin = texte.indexOf('\n\n');
  while (fin !== -1) {
    const trame = lireBloc(texte.slice(debut, fin));
    if (trame !== null) trames.push(trame);
    debut = fin + 2;
    fin = texte.indexOf('\n\n', debut);
  }
  return { trames, reste: texte.slice(debut) };
}

export class FluxDistant {
  private ctl: AbortController | null = null;
  private reprise: ReturnType<typeof setTimeout> | null = null;
  private veille: ReturnType<typeof setTimeout> | null = null;
  private essais = 0;
  private depuis: number | null;
  private connecte = false;

  constructor(private readonly d: DependancesFlux) {
    this.depuis = d.depuis;
  }

  /** Vrai quand le flux est ouvert (pas pendant une reprise). */
  get vivant(): boolean {
    return this.connecte;
  }

  demarrer(): void {
    if (this.ctl) return;
    void this.connecter();
  }

  /** Ferme le flux pour de bon : plus de reprise. */
  arreter(): void {
    this.ctl?.abort();
    this.ctl = null;
    this.connecte = false;
    if (this.reprise) clearTimeout(this.reprise);
    if (this.veille) clearTimeout(this.veille);
    this.reprise = null;
    this.veille = null;
  }

  private async connecter(): Promise<void> {
    const ctl = new AbortController();
    this.ctl = ctl;
    const r = await ouvrirFlux(this.d.configDir, this.d.idSession, this.depuis, ctl.signal, this.d.journal);
    if (this.ctl !== ctl) return;
    if (!r.ok) {
      this.echec(r.statut);
      return;
    }
    this.connecte = true;
    this.veiller(ctl);
    await this.lire(r.donnees, ctl);
    if (this.veille) clearTimeout(this.veille);
    this.veille = null;
    this.connecte = false;
    if (this.ctl === ctl) this.planifier();
  }

  private echec(statut: number): void {
    if (!REFUS_DURABLES.has(statut)) {
      this.planifier();
      return;
    }
    this.d.journal.warn({ statut }, 'flux claude.ai refusé : pas de reprise, sondage seul');
    this.arreter();
    this.d.surRefus(statut);
  }

  private async lire(corps: ReadableStream<Uint8Array>, ctl: AbortController): Promise<void> {
    const lecteur = corps.getReader();
    const decodeur = new TextDecoder();
    let tampon = '';
    try {
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) return;
        this.veiller(ctl);
        tampon += decodeur.decode(value, { stream: true });
        const { trames, reste } = lireTrames(tampon);
        tampon = reste;
        for (const trame of trames) this.recevoir(trame);
      }
    } catch (erreur) {
      if (!ctl.signal.aborted) this.d.journal.warn({ err: erreur }, 'flux claude.ai : lecture interrompue');
    } finally {
      lecteur.cancel().catch((erreur: unknown) => this.d.journal.debug({ err: erreur }, 'flux claude.ai : fermeture'));
    }
  }

  private recevoir(trame: TrameSse): void {
    this.essais = 0;
    if (trame.id !== null && (this.depuis === null || trame.id > this.depuis)) this.depuis = trame.id;
    this.d.surTrame(trame);
  }

  // Un flux qui ne reçoit plus rien (ni trame ni keepalive) est coupé : la reprise prend le relais.
  private veiller(ctl: AbortController): void {
    if (this.veille) clearTimeout(this.veille);
    this.veille = setTimeout(() => {
      if (this.ctl !== ctl) return;
      this.d.journal.info('flux claude.ai : silence prolongé, reprise');
      ctl.abort();
    }, this.d.silenceMs ?? SILENCE_MS);
  }

  private planifier(): void {
    this.essais++;
    const base = this.d.delaiBaseMs ?? DELAI_BASE_MS;
    const max = this.d.delaiMaxMs ?? DELAI_MAX_MS;
    const delai = Math.min(base * 2 ** (this.essais - 1), max) * (0.75 + Math.random() * 0.5);
    this.reprise = setTimeout(() => {
      this.reprise = null;
      void this.connecter();
    }, delai);
  }
}
