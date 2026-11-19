// Responsabilité : la configuration Claude d'une machine (styles, CLAUDE.md, compétences, connecteurs, plug-ins). Le
// poste de la machine lit et change ses fichiers ; le relais valide la requête, vérifie la machine et relaie.
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  ConnecteurMachine,
  DefinitionConnecteur,
  IdPlugin,
  MASQUE_VALEUR,
  NomConnecteur,
  NomStyle,
} from '../../commun/configuration.ts';
import type { Postes } from '../parc/postes.ts';
import { CacheConnecteurs } from './cache-connecteurs.ts';
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
  private readonly cache: CacheConnecteurs;

  constructor(
    private readonly postes: Lecteur,
    journal: Logger,
  ) {
    this.cache = new CacheConnecteurs((machine) => this.relireConnecteurs(machine), journal);
  }

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

  // Liste servie depuis le cache de la machine, avec sa `fraicheur` ; une écriture l'a rendue périmée.
  async connecteurs(req: Requete): Promise<Response> {
    const id = req.params['id'];
    if (!this.connue(id)) return erreur('machine inconnue', 404);
    const r = await this.cache.lire(id ?? '');
    return r.ok ? json(r.valeur) : erreur(r.erreur, REFUS_POSTE);
  }

  // Définition d'un connecteur de l'utilisateur ; valeurs de variables et d'en-têtes masquées sauf `?reveler=1`.
  async connecteur(req: Requete): Promise<Response> {
    const nom = NomConnecteur.safeParse(req.params['nom']);
    if (!nom.success) return erreur('nom de connecteur invalide', 400);
    const reveler = new URL(req.url).searchParams.get('reveler') === '1';
    return this.commander(req.params['id'], { kind: 'connecteur_lire', nom: nom.data, reveler });
  }

  async ajouterConnecteur(req: Requete): Promise<Response> {
    const c = await lireCorps(req, DefinitionConnecteur);
    if (c instanceof Response) return c;
    if ([...Object.values(c.variables), ...Object.values(c.entetes)].includes(MASQUE_VALEUR)) {
      return erreur('valeur à saisir : la valeur est masquée', 400);
    }
    return this.ecrire(req.params['id'], { kind: 'connecteur_ajouter', definition: c }, 201);
  }

  async modifierConnecteur(req: Requete): Promise<Response> {
    const nom = NomConnecteur.safeParse(req.params['nom']);
    if (!nom.success) return erreur('nom de connecteur invalide', 400);
    const c = await lireCorps(req, DefinitionConnecteur);
    if (c instanceof Response) return c;
    return this.ecrire(req.params['id'], { kind: 'connecteur_modifier', nom: nom.data, definition: c });
  }

  async retirerConnecteur(req: Requete): Promise<Response> {
    const nom = NomConnecteur.safeParse(req.params['nom']);
    if (!nom.success) return erreur('nom de connecteur invalide', 400);
    return this.ecrire(req.params['id'], { kind: 'connecteur_retirer', nom: nom.data });
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

  // Écriture : le cache de la machine est périmé même si le poste a refusé (une restauration peut avoir eu lieu).
  private async ecrire(id: string | undefined, c: Commande, statut = 200): Promise<Response> {
    const reponse = await this.commander(id, c, statut);
    this.cache.invalider(id ?? '');
    return reponse;
  }

  private async relireConnecteurs(
    machine: string,
  ): Promise<{ ok: true; connecteurs: ConnecteurMachine[] } | { ok: false; erreur: string }> {
    const r = await this.postes.commander(machine, { kind: 'connecteurs_machine' });
    if (!r.ok) return { ok: false, erreur: r.erreur ?? 'connecteurs refusés' };
    const lus = z.array(ConnecteurMachine).safeParse(r.donnees);
    return lus.success ? { ok: true, connecteurs: lus.data } : { ok: false, erreur: 'réponse du poste illisible' };
  }
}
