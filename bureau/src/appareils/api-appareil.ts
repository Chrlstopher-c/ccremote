// Responsabilité : les fichiers et terminaux d'un appareil, par l'API du relais — même jeton que le reste de l'app.
import type { ListeDossier } from '../../../commun/appareil.ts';
import { type ClientRelais, ErreurApi } from '../shared/api/client.ts';
import { journal } from '../shared/journal.ts';

async function lireErreur(r: Response): Promise<ErreurApi> {
  const texte = await r.text();
  try {
    return new ErreurApi(r.status, (JSON.parse(texte) as { erreur?: string }).erreur ?? texte);
  } catch {
    return new ErreurApi(r.status, texte || `erreur ${r.status}`);
  }
}

export class ApiAppareil {
  constructor(
    private readonly client: ClientRelais,
    readonly machine: string,
  ) {}

  private url(chemin: string, params: Record<string, string> = {}): string {
    const q = new URLSearchParams(params).toString();
    return `${this.client.base}/api/machines/${encodeURIComponent(this.machine)}${chemin}${q ? `?${q}` : ''}`;
  }

  private async requete(url: string, init: RequestInit = {}): Promise<Response> {
    let r: Response;
    try {
      r = await fetch(url, { ...init, headers: { authorization: `Bearer ${this.client.jetonFlux}`, ...init.headers } });
    } catch (erreur) {
      journal.warn({ machine: this.machine, erreur: String(erreur) }, 'relais injoignable');
      throw new ErreurApi(0, 'relais injoignable');
    }
    if (!r.ok) throw await lireErreur(r);
    return r;
  }

  private async action(chemin: string, corps: unknown): Promise<void> {
    await this.requete(this.url(chemin), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    });
  }

  async lister(chemin?: string): Promise<ListeDossier> {
    const r = await this.requete(this.url('/fichiers', chemin ? { chemin } : {}));
    return (await r.json()) as ListeDossier; // forme garantie par le schéma ListeDossier côté poste
  }

  async lire(chemin: string): Promise<Blob> {
    return (await this.requete(this.url('/fichier', { chemin }))).blob();
  }

  async lireTexte(chemin: string): Promise<string> {
    return (await this.requete(this.url('/fichier', { chemin }))).text();
  }

  async deposer(chemin: string, contenu: Blob | string): Promise<void> {
    await this.requete(this.url('/fichier', { chemin }), { method: 'PUT', body: contenu });
  }

  supprimer(chemin: string): Promise<void> {
    return this.action('/fichiers/supprimer', { chemin });
  }

  renommer(de: string, vers: string): Promise<void> {
    return this.action('/fichiers/renommer', { de, vers });
  }

  creerDossier(chemin: string): Promise<void> {
    return this.action('/fichiers/dossier', { chemin });
  }

  /** Le téléchargement passe par un lien éphémère vers le blob : le jeton ne va jamais dans une URL. */
  async telecharger(chemin: string, nom: string): Promise<void> {
    const url = URL.createObjectURL(await this.lire(chemin));
    const a = Object.assign(document.createElement('a'), { href: url, download: nom });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  urlTerminal(cible: { tmux?: string; dossier?: string }, colonnes: number, lignes: number): string {
    const q = new URLSearchParams({ machine: this.machine, colonnes: String(colonnes), lignes: String(lignes) });
    if (cible.tmux) q.set('tmux', cible.tmux);
    if (cible.dossier) q.set('dossier', cible.dossier);
    return `${this.client.base.replace(/^http/, 'ws')}/api/terminal?${q}`;
  }

  get jeton(): string {
    return this.client.jetonFlux;
  }
}

export function joindre(dossier: string, nom: string): string {
  return dossier.endsWith('/') ? `${dossier}${nom}` : `${dossier}/${nom}`;
}
