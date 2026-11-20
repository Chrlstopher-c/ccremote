// Responsabilité : le relevé d'usage des comptes Claude Code du parc. Un seul relevé par compte réel : le relais choisit
// le poste qui relève (un poste en ligne qui a ce compte), cadence les appels (un par compte et par endpoint toutes les
// 5 min, recul exponentiel sur 429, Retry-After respecté), garde la dernière valeur bonne en base et la pose sur les vues.
import type { Database } from 'bun:sqlite';
import type { Logger } from 'pino';
import { DonneesReleve, type EtatCompte, FenetresUsage, type LimiteSdk } from '../../commun/comptes.ts';

export const CADENCE_MS = 5 * 60_000;
const RECUL_DEPART_MIN = 5;
const RECUL_PLAFOND_MIN = 60;

export interface PosteReleve {
  enLigne(machine: string): boolean;
  commander(
    machine: string,
    commande: { kind: 'compte_releve'; nom: string },
  ): Promise<{ ok: boolean; donnees?: unknown; erreur?: string }>;
}

export interface MachinesReleve {
  machines(): { readonly id: string; readonly etatComptes: readonly EtatCompte[] }[];
}

interface Ligne {
  cle: string;
  releveur: string | null;
  prochain_le: string | null;
  recul_min: number;
  usage: string | null;
  cedar: string | null;
  fenetres: string | null;
  releve_le: string | null;
  erreur: string | null;
}

/** Ce qui sert à un détail de compte : le corps brut de l'endpoint d'usage et des réinitialisations. */
export interface UsageBrut {
  readonly usage: unknown;
  readonly cedar: unknown;
}

const heure = (ms: number): string => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export class ReleveUsage {
  private readonly enCours = new Map<string, Promise<void>>();

  constructor(
    private readonly base: Database,
    private readonly registre: MachinesReleve,
    private readonly postes: PosteReleve,
    private readonly journal: Logger,
    private readonly rafraichir: () => void,
    private readonly maintenant: () => number = Date.now,
  ) {
    base.exec(`CREATE TABLE IF NOT EXISTS usage_comptes (
      cle TEXT PRIMARY KEY, releveur TEXT, prochain_le TEXT, recul_min INTEGER NOT NULL,
      usage TEXT, cedar TEXT, fenetres TEXT, releve_le TEXT, erreur TEXT)`);
  }

  /** La clé (courriel) d'un compte de la machine, ou null : sert à ouvrir un détail. */
  cleDe(machine: string, nom: string): string | null {
    const compte = this.registre
      .machines()
      .find((m) => m.id === machine)
      ?.etatComptes.find((c) => c.id === nom);
    return compte?.cle ?? null;
  }

  /** Relève le compte si son délai est écoulé ; sinon ne fait rien (la dernière valeur reste servie). */
  releverSiDu(cle: string): Promise<void> {
    const prochain = this.ligne(cle)?.prochain_le;
    if (prochain && Date.parse(prochain) > this.maintenant()) return Promise.resolve();
    return this.releverCle(cle);
  }

  /** Relève, chacun selon son délai, tous les comptes connectés du parc. */
  async tick(): Promise<void> {
    const cles = new Set<string>();
    for (const m of this.registre.machines())
      for (const c of m.etatComptes) if (c.connecte && c.cle !== null) cles.add(c.cle);
    await Promise.all([...cles].map((cle) => this.releverSiDu(cle)));
  }

  /** Fenêtre vue dans le flux SDK d'un poste : elle devient la dernière valeur de sa fenêtre, sans appel à l'API. */
  recevoirLimite(cle: string, limite: LimiteSdk): void {
    const t = this.maintenant();
    const l = this.ligne(cle);
    const lue = l?.fenetres ? FenetresUsage.safeParse(JSON.parse(l.fenetres)) : null;
    const actuelles = lue?.success ? lue.data : { session: null, semaine: null, autres: [] };
    const fenetres = { ...actuelles, [limite.genre]: limite.fenetre };
    this.base
      .query(
        `INSERT INTO usage_comptes (cle, prochain_le, recul_min, fenetres, releve_le)
      VALUES ($cle, $prochain, $recul, $fenetres, $releveLe)
      ON CONFLICT(cle) DO UPDATE SET fenetres = $fenetres, releve_le = $releveLe`,
      )
      .run({
        cle,
        prochain: l?.prochain_le ?? new Date(t + CADENCE_MS).toISOString(),
        recul: l?.recul_min ?? RECUL_DEPART_MIN,
        fenetres: JSON.stringify(fenetres),
        releveLe: new Date(t).toISOString(),
      });
    this.rafraichir();
  }

  /** Usage brut d'un compte, pour le détail : null tant que le relais n'a rien relevé. */
  brutPour(cle: string): UsageBrut | null {
    const l = this.ligne(cle);
    if (!l || (l.usage === null && l.cedar === null)) return null;
    return {
      usage: l.usage === null ? null : JSON.parse(l.usage),
      cedar: l.cedar === null ? null : JSON.parse(l.cedar),
    };
  }

  /** Pose la dernière valeur bonne et le prochain relevé sur les comptes d'une machine. */
  appliquer(comptes: readonly EtatCompte[]): EtatCompte[] {
    return comptes.map((c) => {
      if (c.cle === null || !c.connecte) return c;
      const l = this.ligne(c.cle);
      const f = l?.fenetres ? FenetresUsage.safeParse(JSON.parse(l.fenetres)) : null;
      const fenetres = f?.success ? f.data : null;
      return {
        ...c,
        session: fenetres?.session ?? null,
        semaine: fenetres?.semaine ?? null,
        autres: fenetres?.autres ?? [],
        usageLe: l?.releve_le ?? null,
        prochainReleve: l?.prochain_le ?? null,
        probleme: l ? (this.problemeDe(l) ?? c.probleme) : (c.probleme ?? 'pas encore relevé'),
      };
    });
  }

  private problemeDe(l: Ligne): string | null {
    if (l.erreur === null) return null;
    const prochain = l.prochain_le ? heure(Date.parse(l.prochain_le)) : 'inconnu';
    if (l.erreur.includes('429')) return `limite de l’API d’usage atteinte : prochain relevé vers ${prochain}`;
    return `relevé d’usage impossible (${l.erreur}) : nouvel essai vers ${prochain}`;
  }

  private releverCle(cle: string): Promise<void> {
    const en = this.enCours.get(cle);
    if (en) return en;
    const p = this.releve(cle).finally(() => this.enCours.delete(cle));
    this.enCours.set(cle, p);
    return p;
  }

  private async releve(cle: string): Promise<void> {
    const choisi = this.choisir(cle);
    if (!choisi) return;
    const reponse = await this.postes.commander(choisi.machine, { kind: 'compte_releve', nom: choisi.nom });
    if (!reponse.ok) {
      this.journal.warn({ compte: cle, poste: choisi.machine, erreur: reponse.erreur }, 'relevé d’usage en échec');
      this.memoriser(cle, choisi.machine, { erreur: reponse.erreur ?? 'poste injoignable' }, CADENCE_MS);
      return;
    }
    const d = DonneesReleve.safeParse(reponse.donnees);
    if (!d.success) {
      this.memoriser(cle, choisi.machine, { erreur: 'réponse du poste illisible' }, CADENCE_MS);
      return;
    }
    this.memoriser(cle, choisi.machine, d.data, CADENCE_MS);
  }

  /** Le poste qui relève : le relevé précédent s'il est toujours en ligne et a ce compte, sinon le premier par nom. */
  private choisir(cle: string): { machine: string; nom: string } | null {
    const candidats = this.registre
      .machines()
      .filter((m) => this.postes.enLigne(m.id))
      .flatMap((m) =>
        m.etatComptes.filter((c) => c.cle === cle && c.connecte).map((c) => ({ machine: m.id, nom: c.id })),
      );
    if (candidats.length === 0) return null;
    const actuel = this.ligne(cle)?.releveur;
    const garde = candidats.find((c) => c.machine === actuel);
    return garde ?? [...candidats].sort((a, b) => a.machine.localeCompare(b.machine))[0] ?? null;
  }

  /** Écrit le résultat d'un relevé : valeurs lues gardées, délai et recul selon le statut (429 : Retry-After ou recul). */
  private memoriser(
    cle: string,
    releveur: string,
    d: Partial<DonneesReleve> & { erreur: string | null },
    cadenceMs: number,
  ): void {
    const t = this.maintenant();
    const l = this.ligne(cle);
    const reculMin = l?.recul_min ?? RECUL_DEPART_MIN;
    const statut = d.statut ?? null;
    const ok = statut === null && d.erreur === null;
    let prochain = t + cadenceMs;
    let recul = reculMin;
    if (statut === 429) {
      prochain = t + (d.retryApresMs ?? reculMin * 60_000);
      recul = Math.min(reculMin * 2, RECUL_PLAFOND_MIN);
    } else if (ok) {
      recul = RECUL_DEPART_MIN;
    }
    const aLu = d.fenetres != null || d.usage != null || d.cedar != null;
    const releveLe = aLu ? new Date(t).toISOString() : (l?.releve_le ?? null);
    const ecrit = {
      cle,
      releveur,
      prochain: new Date(prochain).toISOString(),
      recul,
      usage: d.usage != null ? JSON.stringify(d.usage) : (l?.usage ?? null),
      cedar: d.cedar != null ? JSON.stringify(d.cedar) : (l?.cedar ?? null),
      fenetres: d.fenetres != null ? JSON.stringify(d.fenetres) : (l?.fenetres ?? null),
      releveLe,
      erreur: d.erreur ?? null,
    };
    this.base
      .query(
        `INSERT INTO usage_comptes (cle, releveur, prochain_le, recul_min, usage, cedar, fenetres, releve_le, erreur)
      VALUES ($cle, $releveur, $prochain, $recul, $usage, $cedar, $fenetres, $releveLe, $erreur)
      ON CONFLICT(cle) DO UPDATE SET releveur = $releveur, prochain_le = $prochain, recul_min = $recul,
      usage = $usage, cedar = $cedar, fenetres = $fenetres, releve_le = $releveLe, erreur = $erreur`,
      )
      .run(ecrit);
    this.rafraichir();
  }

  private ligne(cle: string): Ligne | null {
    return this.base.query('SELECT * FROM usage_comptes WHERE cle = $cle').get({ cle }) as Ligne | null;
  }
}
