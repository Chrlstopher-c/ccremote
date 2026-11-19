// Responsabilité : la configuration Claude d'une machine (styles, CLAUDE.md, compétences, connecteurs, plug-ins). Le
// poste de la machine lit et change ses fichiers ; le relais valide la requête, vérifie la machine et relaie.
import { z } from 'zod';
import { IdPlugin, NomStyle } from '../../commun/configuration.ts';
import type { Postes } from '../parc/postes.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from './http.ts';

const CorpsStyleMachine = z.object({
  nom: NomStyle,
  description: z.string().max(300),
  instructions: z.string().min(1).max(20000),
});
const CorpsInstructions = z.object({
  contenu: z.string().max(200000),
  empreinte_avant: z.string().regex(/^[0-9a-f]{64}$/),
});
const CorpsPlugin = z.object({ actif: z.boolean() });

type Requete = Request & { params: Record<string, string> };
type Commande = Parameters<Pick<Postes, 'commander'>['commander']>[1];
type Lecteur = Pick<Postes, 'commander' | 'vues'>;

export class ApiConfiguration {
  constructor(private readonly postes: Lecteur) {}

  async creerStyle(req: Requete): Promise<Response> {
    const c = await lireCorps(req, CorpsStyleMachine);
    if (c instanceof Response) return c;
    return this.commander(req.params['id'], { kind: 'styles_creer', ...c }, 201);
  }

  instructions(req: Requete): Promise<Response> {
    return this.commander(req.params['id'], { kind: 'instructions_lire' });
  }

  // Un CLAUDE.md modifié entre-temps donne 409 `conflit` : rien n'est écrit, la version actuelle est à relire.
  async ecrireInstructions(req: Requete): Promise<Response> {
    const c = await lireCorps(req, CorpsInstructions);
    if (c instanceof Response) return c;
    return this.commander(req.params['id'], { kind: 'instructions_ecrire', ...c });
  }

  competences(req: Requete): Promise<Response> {
    return this.commander(req.params['id'], { kind: 'competences_lister' });
  }

  // Seul un SKILL.md listé par la machine est lu : le poste refuse les autres chemins (`interdit`, 403 ici).
  async contenuCompetence(req: Requete): Promise<Response> {
    const chemin = new URL(req.url).searchParams.get('chemin') ?? '';
    if (!chemin) return erreur('chemin attendu', 400);
    const id = req.params['id'];
    if (!this.connue(id)) return erreur('machine inconnue', 404);
    const r = await this.postes.commander(id ?? '', { kind: 'competences_contenu', chemin });
    if (!r.ok && r.erreur === 'interdit') return erreur('chemin hors des compétences de la machine', 403);
    return r.ok ? json(r.donnees ?? {}) : erreur(r.erreur ?? 'lecture refusée', REFUS_POSTE);
  }

  connecteurs(req: Requete): Promise<Response> {
    return this.commander(req.params['id'], { kind: 'connecteurs_machine' });
  }

  plugins(req: Requete): Promise<Response> {
    return this.commander(req.params['id'], { kind: 'plugins_lister' });
  }

  async activerPlugin(req: Requete): Promise<Response> {
    const plugin = IdPlugin.safeParse(req.params['plugin']);
    if (!plugin.success) return erreur('identifiant de plug-in invalide', 400);
    const c = await lireCorps(req, CorpsPlugin);
    if (c instanceof Response) return c;
    return this.commander(req.params['id'], { kind: 'plugin_activer', plugin: plugin.data, actif: c.actif });
  }

  private connue(id: string | undefined): boolean {
    return id !== undefined && this.postes.vues().some((m) => m.id === id);
  }

  private async commander(id: string | undefined, c: Commande, statut = 200): Promise<Response> {
    if (!this.connue(id)) return erreur('machine inconnue', 404);
    const r = await this.postes.commander(id ?? '', c);
    return r.ok ? json(r.donnees ?? {}, statut) : erreur(r.erreur ?? 'commande refusée', REFUS_POSTE);
  }
}
