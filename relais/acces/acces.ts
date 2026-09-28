// Responsabilité : qui a le droit de parler au relais — mot de passe, jetons révocables, limite de tentatives.
import { createHash, randomBytes } from 'node:crypto';
import type { Registre } from '../registre/registre.ts';

const DUREE_JETON_MS = 90 * 24 * 3600 * 1000;
const FENETRE_ECHECS_MS = 15 * 60 * 1000;
const MAX_ECHECS = 5;
export const NOM_COOKIE = 'ccremote';

export type ResultatConnexion =
  | { readonly ok: true; readonly jeton: string }
  | { readonly ok: false; readonly raison: 'refuse' | 'trop_de_tentatives' };

export class Acces {
  private readonly echecs = new Map<string, { nombre: number; depuis: number }>();

  constructor(private readonly registre: Registre, private readonly empreinteMotDePasse: string) {}

  async connecter(motDePasse: string, ip: string, appareil: string): Promise<ResultatConnexion> {
    if (this.bloque(ip)) return { ok: false, raison: 'trop_de_tentatives' };
    if (!(await Bun.password.verify(motDePasse, this.empreinteMotDePasse))) {
      this.noterEchec(ip);
      return { ok: false, raison: 'refuse' };
    }
    this.echecs.delete(ip);
    const jeton = randomBytes(32).toString('base64url');
    this.registre.creerJeton(empreinte(jeton), appareil.slice(0, 120), new Date(Date.now() + DUREE_JETON_MS).toISOString());
    return { ok: true, jeton };
  }

  autorise(req: Request): boolean {
    const jeton = extraireJeton(req);
    return jeton !== null && this.registre.jetonValide(empreinte(jeton));
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
