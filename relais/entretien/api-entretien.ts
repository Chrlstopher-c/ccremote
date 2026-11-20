// Responsabilité : les gestes et lectures de l'entretien du relais — état, chantiers, processus, arrêts, liaison,
// réveil. Chaque lecture ou geste est relayé au poste concerné, ou exécuté par SSH sur la machine ; rien n'est deviné.
import type { Logger } from 'pino';
import { z } from 'zod';
import type {
  ChantierPoste,
  OccupantLiaison,
  ProcessusPoste,
  ResultatGeste,
  TmuxPoste,
} from '../../commun/entretien.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { ApiMachines } from '../machines/api-machines.ts';
import type { ConnexionSsh, Ssh } from '../machines/ssh.ts';
import type { Tunnels } from '../machines/tunnels.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { assemblerEtat } from './etat.ts';
import { PORT_DISTANT_PRIS } from './controles.ts';
import { etiqueterTunnels, lireChantiersRecus, lireProcessusRecus } from './processus.ts';
import type { Reveil } from './reveil.ts';
import { occupant, tuerOccupant } from './liaisons.ts';

type Requete = Request & { params: Record<string, string> };
type Commande = Parameters<Postes['commander']>[1];

export interface DependancesEntretien {
  readonly postes: Pick<Postes, 'vues' | 'enLigne' | 'commander' | 'infosPoste'>;
  readonly machines: Pick<ApiMachines, 'empreinteAttendue'>;
  readonly registre: { lire(id: string): (ConnexionSsh & { readonly portDistant: number }) | null };
  readonly ssh: Pick<Ssh, 'executer'>;
  readonly tunnels: Pick<Tunnels, 'etat' | 'relancer' | 'pids'> | null;
  readonly reveil: Reveil;
  readonly locale: string | null;
  readonly relais: { readonly version: string; readonly commit: string | null };
  readonly journal: Logger;
}

const CorpsArret = z.object({
  machine: z.string().min(1).max(200),
  pid: z.number().int().min(2),
  debut: z.string().regex(/^\d{1,20}$/),
  force: z.boolean().optional(),
});
const CorpsArretTmux = z.object({ machine: z.string().min(1).max(200), nom: z.string().min(1).max(200) });
const CorpsLiberer = z.object({ pid: z.number().int().min(2) });

interface Reponse<T> {
  readonly ok: boolean;
  readonly donnees: T | null;
  readonly erreur: string | null;
}

export class ApiEntretien {
  private readonly demarreLe = new Date().toISOString();

  constructor(private readonly d: DependancesEntretien) {}

  /** Les versions, ressources, réveil et contrôles de chaque machine. */
  async etat(): Promise<Response> {
    const attendue = await this.d.machines.empreinteAttendue();
    return json(
      assemblerEtat({
        relais: { version: this.d.relais.version, commit: this.d.relais.commit, demarreLe: this.demarreLe },
        vues: this.d.postes.vues(),
        locale: this.d.locale,
        infos: (id) => this.d.postes.infosPoste(id),
        empreinteAttendue: attendue,
        reveil: (id) => this.d.reveil.pour(id, this.candidats()),
      }),
    );
  }

  /** Les fichiers de suivi des agents, machine par machine (lecture seule côté poste). */
  async chantiers(): Promise<Response> {
    const machines = await Promise.all(
      this.d.postes.vues().map(async (v) => {
        const r = await this.interroger(v.id, { kind: 'chantiers' });
        const lus: ChantierPoste[] | null = r.ok ? lireChantiersRecus(r.donnees) : null;
        const erreurLecture = r.ok && lus === null ? 'réponse illisible' : r.erreur;
        return { machine: v.id, joignable: r.ok, erreur: erreurLecture, chantiers: lus ?? [] };
      }),
    );
    return json({ machines });
  }

  /** Les processus du poste et ses sessions tmux, machine par machine. */
  async processus(): Promise<Response> {
    const machines = await Promise.all(
      this.d.postes.vues().map(async (v) => {
        const r = await this.interroger(v.id, { kind: 'processus' });
        const recus = r.ok ? lireProcessusRecus(r.donnees) : null;
        const tunnels = v.id === this.d.locale ? (this.d.tunnels?.pids() ?? []) : [];
        const processus: ProcessusPoste[] = recus ? etiqueterTunnels(recus.processus, tunnels) : [];
        const tmux: TmuxPoste[] = recus?.tmux ?? [];
        const erreurLecture = r.ok && recus === null ? 'réponse illisible' : r.erreur;
        return { machine: v.id, joignable: r.ok, erreur: erreurLecture, processus, tmux };
      }),
    );
    return json({ machines });
  }

  async arreterProcessus(req: Request): Promise<Response> {
    const c = await lireCorps(req, CorpsArret);
    if (c instanceof Response) return c;
    return this.gesteSurPoste(c.machine, {
      kind: 'processus_arreter',
      pid: c.pid,
      debut: c.debut,
      force: c.force ?? false,
    });
  }

  async arreterTmux(req: Request): Promise<Response> {
    const c = await lireCorps(req, CorpsArretTmux);
    if (c instanceof Response) return c;
    return this.gesteSurPoste(c.machine, { kind: 'tmux_arreter', nom: c.nom });
  }

  /** Qui tient la liaison de la machine, seulement si son tunnel signale un port distant déjà pris. */
  async occupant(id: string): Promise<Response> {
    const c = this.d.registre.lire(id);
    if (!c) return erreur('machine inconnue', 404);
    return json(await this.occupantDe(id, c));
  }

  /** Libère la liaison : revérifie que le processus est bien celui qu'on vise, le signale, puis relance le tunnel. */
  async liberer(req: Requete): Promise<Response> {
    const id = req.params['id'] ?? '';
    const c = this.d.registre.lire(id);
    if (!c) return erreur('machine inconnue', 404);
    const corps = await lireCorps(req, CorpsLiberer);
    if (corps instanceof Response) return corps;
    const occ = await this.occupantDe(id, c);
    if (!occ.occupe || occ.pid !== corps.pid) {
      return json({ ok: false, phrase: 'Le processus qui tient la liaison a changé ou n’existe plus' });
    }
    const r = await tuerOccupant({ ssh: this.d.ssh, journal: this.d.journal }, c, corps.pid);
    if (!r.ok) return json(r);
    this.d.tunnels?.relancer(id);
    return json({ ok: true, phrase: 'Liaison libérée, tunnel relancé' });
  }

  async reveiller(id: string): Promise<Response> {
    if (this.d.reveil.macDe(id) === null) return erreur(`${id} ne se réveille pas à distance`, 404);
    const r = await this.d.reveil.reveiller(id, this.candidats());
    return r.ok ? json({ ok: true, par: r.par }) : erreur(r.erreur ?? 'réveil impossible', 409);
  }

  /** Les machines dont le réveil est possible (MAC configurée ou relevée). */
  reveilPossibles(): string[] {
    return this.d.reveil.possibles();
  }

  private candidats(): string[] {
    return this.d.postes
      .vues()
      .filter((v) => v.enLigne)
      .map((v) => v.id);
  }

  private async occupantDe(id: string, c: ConnexionSsh & { readonly portDistant: number }): Promise<OccupantLiaison> {
    const detail = this.d.tunnels?.etat(id).detail ?? null;
    if (!detail?.startsWith(PORT_DISTANT_PRIS)) return { occupe: false, pid: null, depuis: null };
    return occupant({ ssh: this.d.ssh, journal: this.d.journal }, c, c.portDistant);
  }

  private async gesteSurPoste(machine: string, commande: Commande): Promise<Response> {
    const r = await this.interroger(machine, commande);
    if (!r.ok) return json({ ok: false, phrase: r.erreur ?? `${machine} est hors ligne` });
    const g = this.lireGeste(r.donnees);
    return json(g ?? { ok: false, phrase: 'réponse du poste illisible' });
  }

  private lireGeste(donnees: unknown): ResultatGeste | null {
    const g = z.object({ ok: z.boolean(), phrase: z.string() }).safeParse(donnees);
    return g.success ? g.data : null;
  }

  /** Une commande au poste, si la machine est en ligne ; sinon « hors ligne », sans erreur à journaliser. */
  private async interroger(id: string, commande: Commande): Promise<Reponse<unknown>> {
    if (!this.d.postes.enLigne(id)) return { ok: false, donnees: null, erreur: `${id} est hors ligne` };
    const r: ReponsePoste = await this.d.postes.commander(id, commande);
    return r.ok
      ? { ok: true, donnees: r.donnees, erreur: null }
      : { ok: false, donnees: null, erreur: r.erreur ?? 'poste injoignable' };
  }
}
