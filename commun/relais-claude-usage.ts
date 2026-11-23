// Responsabilité : la consommation d'une réponse de l'API (jetons entrée/sortie, modèle) lue au fil d'un flux SSE ou
// dans un corps JSON. Compte des nombres seulement : le contenu n'est jamais gardé. Pur.
import { z } from 'zod';

export interface Consommation {
  readonly entree: number;
  readonly sortie: number;
  readonly modele: string | null;
}

const TAILLE_MAX_OCTETS = 1024 * 1024;

const Usage = z.object({ input_tokens: z.number().nullish(), output_tokens: z.number().nullish() });
const Evenement = z.object({
  model: z.string().nullish(),
  usage: Usage.nullish(),
  message: z.object({ model: z.string().nullish(), usage: Usage.nullish() }).nullish(),
});

/** Lit les jetons et le modèle au fil de la réponse : SSE (`data:`) ou corps JSON entier (au plus 1 Mo). */
export class AnalyseConsommation {
  private entree = 0;
  private sortie = 0;
  private modele: string | null = null;
  private ligne = '';
  private corps = '';
  private corpsTronque = false;
  private readonly decodeur = new TextDecoder();

  constructor(private readonly sse: boolean) {}

  ajouter(octets: Uint8Array): void {
    const texte = this.decodeur.decode(octets, { stream: true });
    if (this.sse) return this.lignes(texte);
    if (this.corps.length + texte.length > TAILLE_MAX_OCTETS) {
      this.corpsTronque = true;
      return;
    }
    this.corps += texte;
  }

  bilan(): Consommation {
    if (this.sse) {
      if (this.ligne.startsWith('data:')) this.retenir(this.ligne.slice(5));
    } else if (!this.corpsTronque) {
      this.retenir(this.corps);
    }
    return { entree: this.entree, sortie: this.sortie, modele: this.modele };
  }

  private lignes(texte: string): void {
    const morceaux = (this.ligne + texte).split('\n');
    this.ligne = morceaux.pop() ?? '';
    if (this.ligne.length > TAILLE_MAX_OCTETS) this.ligne = '';
    for (const ligne of morceaux) if (ligne.startsWith('data:')) this.retenir(ligne.slice(5));
  }

  private retenir(json: string): void {
    let brut: unknown;
    try {
      brut = JSON.parse(json);
    } catch {
      return;
    }
    const lu = Evenement.safeParse(brut);
    if (!lu.success) return;
    const modele = lu.data.message?.model ?? lu.data.model;
    if (modele) this.modele = modele;
    const usage = lu.data.message?.usage ?? lu.data.usage;
    // Dans un flux, la sortie est cumulée d'un événement à l'autre : on garde le plus grand compte vu.
    this.entree = Math.max(this.entree, usage?.input_tokens ?? 0);
    this.sortie = Math.max(this.sortie, usage?.output_tokens ?? 0);
  }
}
