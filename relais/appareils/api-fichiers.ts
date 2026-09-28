// Responsabilité : les fichiers d'un appareil par l'API des clients — lister, télécharger (en flux, par morceaux),
// déposer, renommer, supprimer, créer un dossier. Le relais ne garde rien : il transmet au poste de la machine.
import { basename } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { TAILLE_MORCEAU } from '../../commun/appareil.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from '../clients/http.ts';

type Requete = Request & { params: Record<string, string> };
const Chemin = z.string().min(1).max(4096);
const Morceau = z.object({ taille: z.number(), base64: z.string() });

function reponse(r: ReponsePoste): Response {
  return r.ok ? json(r.donnees ?? { ok: true }) : erreur(r.erreur ?? 'refusé', REFUS_POSTE);
}

/** Le type d'un fichier d'après son nom : l'aperçu d'une image ou d'une vidéo en dépend dans le navigateur. */
export function typeMime(chemin: string): string {
  const type = Bun.file(basename(chemin)).type;
  return type.startsWith('text/') && !type.includes('charset') ? `${type};charset=utf-8` : type;
}

export class ApiFichiers {
  constructor(
    private readonly postes: Postes,
    private readonly journal: Logger,
  ) {}

  lister(req: Requete): Promise<Response> {
    const chemin = new URL(req.url).searchParams.get('chemin') ?? undefined;
    return this.postes.commander(req.params['id'] ?? '', { kind: 'fichiers_lister', chemin }).then(reponse);
  }

  async lire(req: Requete): Promise<Response> {
    const machine = req.params['id'] ?? '';
    const url = new URL(req.url);
    const chemin = url.searchParams.get('chemin') ?? '';
    if (!chemin) return erreur('chemin manquant');
    const premier = await this.morceau(machine, chemin, 0);
    if (premier instanceof Response) return premier;
    const entetes: Record<string, string> = {
      'content-type': typeMime(chemin),
      'content-length': String(premier.taille),
      'cache-control': 'no-store',
    };
    if (url.searchParams.get('telecharger') === '1') {
      entetes['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(basename(chemin))}`;
    }
    return new Response(this.flux(machine, chemin, premier), { headers: entetes });
  }

  async deposer(req: Requete): Promise<Response> {
    const machine = req.params['id'] ?? '';
    const chemin = new URL(req.url).searchParams.get('chemin') ?? '';
    if (!chemin) return erreur('chemin manquant');
    const octets = Buffer.from(await req.arrayBuffer());
    for (let debut = 0; debut === 0 || debut < octets.length; debut += TAILLE_MORCEAU) {
      const base64 = octets.subarray(debut, debut + TAILLE_MORCEAU).toString('base64');
      const r = await this.postes.commander(machine, { kind: 'fichier_ecrire', chemin, base64, ajout: debut > 0 });
      if (!r.ok) return reponse(r);
    }
    this.journal.info({ machine, taille: octets.length }, 'fichier déposé');
    return json({ ok: true, taille: octets.length });
  }

  async supprimer(req: Requete): Promise<Response> {
    const c = await lireCorps(req, z.object({ chemin: Chemin }));
    if (c instanceof Response) return c;
    return reponse(
      await this.postes.commander(req.params['id'] ?? '', { kind: 'fichier_supprimer', chemin: c.chemin }),
    );
  }

  async renommer(req: Requete): Promise<Response> {
    const c = await lireCorps(req, z.object({ de: Chemin, vers: Chemin }));
    if (c instanceof Response) return c;
    return reponse(await this.postes.commander(req.params['id'] ?? '', { kind: 'fichier_renommer', ...c }));
  }

  async creerDossier(req: Requete): Promise<Response> {
    const c = await lireCorps(req, z.object({ chemin: Chemin }));
    if (c instanceof Response) return c;
    return reponse(await this.postes.commander(req.params['id'] ?? '', { kind: 'dossier_creer', chemin: c.chemin }));
  }

  private async morceau(machine: string, chemin: string, debut: number) {
    const r = await this.postes.commander(machine, { kind: 'fichier_lire', chemin, debut, longueur: TAILLE_MORCEAU });
    if (!r.ok) return reponse(r);
    const m = Morceau.safeParse(r.donnees);
    return m.success ? m.data : erreur('réponse du poste illisible', REFUS_POSTE);
  }

  // Le premier morceau est déjà là (il a donné la taille) ; les suivants sont demandés au rythme du lecteur.
  private flux(machine: string, chemin: string, premier: z.infer<typeof Morceau>): ReadableStream<Uint8Array> {
    let debut = 0;
    let suivant: z.infer<typeof Morceau> | null = premier;
    return new ReadableStream({
      pull: async (controleur) => {
        const m = suivant ?? (await this.morceau(machine, chemin, debut));
        suivant = null;
        if (m instanceof Response) return controleur.error(new Error('lecture interrompue par le poste'));
        const octets = Buffer.from(m.base64, 'base64');
        if (octets.length > 0) controleur.enqueue(octets);
        debut += octets.length;
        if (octets.length === 0 || debut >= m.taille) controleur.close();
      },
    });
  }
}

type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;

export function routesFichiers(f: ApiFichiers, protege: Protection) {
  return {
    '/api/machines/:id/fichiers': { GET: protege((req) => f.lister(req)) },
    '/api/machines/:id/fichier': { GET: protege((req) => f.lire(req)), PUT: protege((req) => f.deposer(req)) },
    '/api/machines/:id/fichiers/supprimer': { POST: protege((req) => f.supprimer(req)) },
    '/api/machines/:id/fichiers/renommer': { POST: protege((req) => f.renommer(req)) },
    '/api/machines/:id/fichiers/dossier': { POST: protege((req) => f.creerDossier(req)) },
  };
}
