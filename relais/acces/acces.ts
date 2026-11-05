// Responsabilité : qui a le droit de parler au relais — mot de passe, jetons révocables, limite de tentatives.
import { createHash, randomBytes } from 'node:crypto';
import type { DemandeAcces, GenreAcces, NouvelAcces, VueAcces } from '../../commun/api-clients.ts';
import type { Registre } from '../registre/registre.ts';
import type { PlafondEchecs } from './plafond.ts';

const DUREE_JETON_MS = 90 * 24 * 3600 * 1000;
const FENETRE_ECHECS_MS = 15 * 60 * 1000;
const MAX_ECHECS = 5;
const USAGE_NOTE_MS = 5 * 60 * 1000; // « vu le » : une écriture au plus toutes les 5 min par jeton
export const LONGUEUR_ID = 12;
export const NOM_COOKIE = 'ccremote';

export type ResultatConnexion =
  | { readonly ok: true; readonly jeton: string }
  | { readonly ok: false; readonly raison: 'refuse' | 'trop_de_tentatives' };

export class Acces {
  private readonly echecs = new Map<string, { nombre: number; depuis: number }>();
  private readonly usages = new Map<string, number>();

  constructor(
    private readonly registre: Registre,
    private readonly empreinteMotDePasse: string,
    private readonly plafond: PlafondEchecs,
  ) {}

  async connecter(motDePasse: string, ip: string, appareil: string): Promise<ResultatConnexion> {
    if (this.plafond.atteint() || this.bloque(ip)) return { ok: false, raison: 'trop_de_tentatives' };
    if (!(await Bun.password.verify(motDePasse, this.empreinteMotDePasse))) {
      this.noterEchec(ip);
      this.plafond.noter();
      return { ok: false, raison: 'refuse' };
    }
    this.echecs.delete(ip);
    const jeton = randomBytes(32).toString('base64url');
    this.registre.creerJeton(
      empreinte(jeton),
      appareil.slice(0, 120),
      new Date(Date.now() + DUREE_JETON_MS).toISOString(),
    );
    return { ok: true, jeton };
  }

  autorise(req: Request): boolean {
    return this.genre(req) !== null;
  }

  /** Le genre de l'accès qui porte la requête (null : refusé). Note l'usage au passage. */
  genre(req: Request): GenreAcces | null {
    const jeton = extraireJeton(req);
    return jeton === null ? null : this.genreDuJeton(jeton);
  }

  genreDuJeton(jeton: string): GenreAcces | null {
    const e = empreinte(jeton);
    const genre = this.registre.genreJeton(e);
    if (genre && Date.now() - (this.usages.get(e) ?? 0) > USAGE_NOTE_MS) {
      this.usages.set(e, Date.now());
      this.registre.noterUsageJeton(e, new Date().toISOString());
    }
    return genre;
  }

  emettre(d: DemandeAcces): NouvelAcces {
    const jeton = randomBytes(32).toString('base64url');
    const e = empreinte(jeton);
    const expire = new Date(Date.now() + d.jours * 24 * 3600 * 1000).toISOString();
    this.registre.creerJeton(e, d.nom.slice(0, 120), expire, d.genre);
    return { id: e.slice(0, LONGUEUR_ID), jeton };
  }

  lister(req: Request): VueAcces[] {
    const jeton = extraireJeton(req);
    const courant = jeton ? empreinte(jeton) : '';
    this.registre.purgerJetonsExpires();
    return this.registre.jetons().map((l) => ({
      id: l.empreinte.slice(0, LONGUEUR_ID),
      nom: l.appareil,
      genre: l.genre,
      creeLe: l.cree_le,
      expireLe: l.expire_le,
      vuLe: l.vu_le,
      courant: l.empreinte === courant,
    }));
  }

  revoquer(id: string): boolean {
    if (!new RegExp(`^[0-9a-f]{${LONGUEUR_ID}}$`).test(id)) return false;
    for (const e of this.usages.keys()) if (e.startsWith(id)) this.usages.delete(e);
    return this.registre.revoquerJetonParId(id) > 0;
  }

  deconnecter(req: Request): void {
    const jeton = extraireJeton(req);
    if (jeton) this.registre.revoquerJeton(empreinte(jeton));
  }

  private bloque(ip: string): boolean {
    const e = this.echecs.get(ip);
    if (!e) return false;
    if (Date.now() - e.depuis > FENETRE_ECHECS_MS) {
      this.echecs.delete(ip);
      return false;
    }
    return e.nombre >= MAX_ECHECS;
  }

  private noterEchec(ip: string): void {
    const e = this.echecs.get(ip);
    if (e && Date.now() - e.depuis <= FENETRE_ECHECS_MS) e.nombre += 1;
    else this.echecs.set(ip, { nombre: 1, depuis: Date.now() });
  }
}

// Le jeton n'est jamais stocké en clair : une fuite de la base ne donne accès à rien.
function empreinte(jeton: string): string {
  return createHash('sha256').update(jeton).digest('hex');
}

export const PROTOCOLE_FLUX = 'ccremote';

export function extraireJeton(req: Request): string | null {
  const entete = req.headers.get('authorization');
  if (entete?.startsWith('Bearer ')) return entete.slice(7);
  // WebSocket du navigateur : pas d'en-tête possible, le jeton voyage en second sous-protocole (jamais dans l'URL).
  const protocoles = (req.headers.get('sec-websocket-protocol') ?? '').split(',').map((p) => p.trim());
  if (protocoles[0] === PROTOCOLE_FLUX && protocoles[1]) return protocoles[1];
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${NOM_COOKIE}=([^;]+)`));
  return m?.[1] ?? null;
}

export function cookieDeSession(jeton: string): string {
  return `${NOM_COOKIE}=${jeton}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DUREE_JETON_MS / 1000}`;
}
