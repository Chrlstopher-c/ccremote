/**
 * Responsabilité : parler au harness de production depuis un poste de dev, avec
 * les MÊMES routes que l'interface web — jamais un chemin de test parallèle.
 *
 * `☠` C'est la condition de validité du banc. Un client qui taperait ailleurs
 * (accès direct au registre, port interne, doublure) mesurerait un système que
 * personne n'utilise ; le premier défaut trouvé serait invérifiable à l'écran et
 * le premier défaut de l'écran serait invisible ici. Tout passe donc par
 * `pi-web`, authentification comprise.
 *
 * `☠` Le jeton de session est `sha256(UI_PASSWORD)` — c'est la définition de
 * `pi-web/app.py`, pas une reconstitution : le calculer ici évite un aller-retour
 * de login à chaque commande. S'il cesse de fonctionner, la cause est un
 * changement du schéma de session côté `app.py`, pas une expiration.
 */

import { createHash } from 'node:crypto';

export const BASE_DEFAUT = 'https://ccremote.exemple.com';

/** Aucune commande du banc ne doit pouvoir pendre indéfiniment. */
const DELAI_APPEL_MS = 30_000;

export class ErreurPilote extends Error {
  constructor(
    message: string,
    readonly statut?: number,
  ) {
    super(message);
    this.name = 'ErreurPilote';
  }
}

/** Enveloppe H-75 : « PC absent » est un ÉTAT, jamais une erreur HTTP. */
export interface Enveloppe<T> {
  readonly pcOnline: boolean;
  readonly stale: boolean;
  readonly data: T;
}

export interface EvenementFil {
  readonly seq: number;
  readonly type: string;
  readonly contenu: string;
  readonly at: number;
  readonly model: string | null;
  readonly effort: string | null;
}

export interface FilConversation {
  readonly id: string;
  readonly titre: string;
  readonly events: readonly EvenementFil[];
  readonly cursor: number;
  /** Un tour est en cours côté modèle — c'est le signal d'attente du banc. */
  readonly generating: boolean;
  readonly contextPct: number | null;
  readonly compactions: number;
}

export interface ResumeConversation {
  readonly id: string;
  readonly titre: string;
  readonly majA: number;
  readonly active: boolean;
}

export interface MissionParc {
  readonly id: string;
  readonly title: string;
  readonly project: string;
  readonly state: string;
  readonly cost: number;
  readonly ctx: number;
  readonly model: string;
  readonly team: string;
}

export class ClientPilote {
  private readonly jeton: string;

  constructor(
    motDePasse: string,
    private readonly base: string = BASE_DEFAUT,
  ) {
    this.jeton = createHash('sha256').update(motDePasse).digest('hex');
  }

  /**
   * `☠` Toute réponse non-2xx devient une `ErreurPilote` PORTANT le corps rendu
   * par le serveur. Le harness explique ses refus (409 de mandat déjà tranché,
   * 501 d'orchestrateur inactif) et cette explication est la seule chose utile :
   * l'avaler pour ne garder que le code laisserait l'opérateur — moi — deviner.
   */
  private async appeler<T>(chemin: string, methode: 'GET' | 'POST', corps?: unknown): Promise<T> {
    const url = `${this.base}/api/harness${chemin}`;
    let reponse: Response;
    try {
      reponse = await fetch(url, {
        method: methode,
        headers: {
          Cookie: `session=${this.jeton}`,
          ...(corps === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
        signal: AbortSignal.timeout(DELAI_APPEL_MS),
      });
    } catch (erreur) {
      throw new ErreurPilote(`${methode} ${chemin} injoignable : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    }
    const texte = await reponse.text();
    if (!reponse.ok) throw new ErreurPilote(`${methode} ${chemin} → ${reponse.status} : ${texte.slice(0, 400)}`, reponse.status);
    try {
      return JSON.parse(texte) as T;
    } catch {
      throw new ErreurPilote(`${methode} ${chemin} : réponse illisible (${texte.slice(0, 200)})`);
    }
  }

  async sante(): Promise<{ readonly ok: boolean; readonly pcOnline: boolean }> {
    return this.appeler('/health', 'GET');
  }

  async conversations(): Promise<Enveloppe<readonly ResumeConversation[]>> {
    return this.appeler('/orchestrator/conversations', 'GET');
  }

  async fil(conversationId: string): Promise<Enveloppe<FilConversation>> {
    return this.appeler(`/orchestrator/conversations/${encodeURIComponent(conversationId)}`, 'GET');
  }

  async creerConversation(titre?: string): Promise<{ readonly conversation: ResumeConversation }> {
    return this.appeler('/orchestrator/conversations', 'POST', titre === undefined ? {} : { titre });
  }

  /**
   * `☠` Rend la main immédiatement : le harness enfile le message et la réponse
   * arrive par le flux. Un appelant qui croirait le tour terminé au retour de
   * cette méthode lirait le fil AVANT que le modèle ait parlé — d'où
   * `attendreFinDeTour`, qui est le pendant obligatoire de cet appel.
   */
  async envoyer(conversationId: string, texte: string, modele?: string, effort?: string): Promise<void> {
    await this.appeler(`/orchestrator/conversations/${encodeURIComponent(conversationId)}/message`, 'POST', {
      text: texte,
      ...(modele === undefined ? {} : { model: modele }),
      ...(effort === undefined ? {} : { effort }),
    });
  }

  async missions(): Promise<Enveloppe<readonly MissionParc[]>> {
    return this.appeler('/missions', 'GET');
  }

  async mission(missionId: string): Promise<Enveloppe<Record<string, unknown>>> {
    return this.appeler(`/missions/${encodeURIComponent(missionId)}`, 'GET');
  }

  async propositions(): Promise<Enveloppe<readonly Record<string, unknown>[]>> {
    return this.appeler('/orchestrator/propositions', 'GET');
  }

  async trancherMandat(propositionId: string, decision: 'approve' | 'reject'): Promise<unknown> {
    return this.appeler(`/orchestrator/mandates/${encodeURIComponent(propositionId)}/${decision}`, 'POST', {});
  }

  async inspecter(missionId: string): Promise<unknown> {
    return this.appeler(`/missions/${encodeURIComponent(missionId)}/inspect`, 'POST', {});
  }
}

/**
 * Attend la fin du tour en cours, borné dans le temps.
 *
 * `☠` Boucle BORNÉE (règle JPL du dépôt) : un tour d'orchestrateur qui part en
 * vrille immobiliserait le banc pour toujours. Au dépassement on rend la main en
 * DISANT que le tour court encore — jamais en prétendant qu'il est fini, ce qui
 * ferait lire un fil incomplet et conclure sur du vide.
 *
 * `☠` On attend d'abord que `generating` PASSE À VRAI. Le harness enfile le
 * message et le tour démarre avec un retard de l'ordre de la seconde : sonder
 * tout de suite verrait `generating: false` — l'état d'AVANT — et rendrait la
 * main immédiatement, sur le fil précédent. C'est le piège classique du
 * « déjà fini » qui n'a pas commencé.
 */
export async function attendreFinDeTour(
  client: ClientPilote,
  conversationId: string,
  timeoutMs = 600_000,
  pasMs = 3_000,
): Promise<{ readonly fini: boolean; readonly fil: FilConversation }> {
  const echeance = Date.now() + timeoutMs;
  const echeanceDemarrage = Date.now() + 30_000;
  let demarre = false;
  let dernier: FilConversation | null = null;
  while (Date.now() < echeance) {
    const { data } = await client.fil(conversationId);
    dernier = data;
    if (data.generating) demarre = true;
    else if (demarre) return { fini: true, fil: data };
    else if (Date.now() > echeanceDemarrage) return { fini: true, fil: data };
    await Bun.sleep(pasMs);
  }
  if (dernier === null) throw new ErreurPilote('aucune lecture du fil n’a abouti');
  return { fini: false, fil: dernier };
}
