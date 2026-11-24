// Responsabilité : côté nœud du chef — une requête Claude d'un invité : verdict, appel de l'API avec le jeton du
// compte, réponse relayée au fil de l'eau, annulation, consommation comptée. Le jeton ne sort jamais d'ici ; le
// corps, les en-têtes d'authentification et le contenu ne sont jamais journalisés.
import type { Logger } from 'pino';
import type { MessageChiffre } from '../../commun/federation.ts';
import type { ReglagesInvite, VerdictPart } from '../../commun/invites.ts';
import {
  type ClaudeRequete,
  erreurAnthropic,
  entetesReponse,
  entetesRequete,
  fusionnerBeta,
  OCTETS_MORCEAU_CLAUDE,
  type TypeErreurClaude,
  VERSION_API,
} from '../../commun/relais-claude.ts';
import { AnalyseConsommation, type Consommation } from '../../commun/relais-claude-usage.ts';
import type { Releve } from './part.ts';
import type { SuiviSessionsClaude } from './relais-claude-suivi.ts';
import { SANS_SESSION, verdictRequeteClaude } from './relais-claude-verdict.ts';

/** Un pair relié : ce qu'on lui envoie (messages chiffrés). */
export interface EmetteurClaude {
  readonly membre: string;
  envoyer(message: MessageChiffre): boolean;
}

export interface PortServeurClaude {
  readonly moi: () => string | null;
  readonly reglagesDe: (membre: string) => ReglagesInvite | null;
  readonly partDe: (membre: string, reglages: ReglagesInvite) => VerdictPart;
  readonly jetonAbonnement: () => string | null;
  /** Fait renouveler le jeton expiré par Claude Code (vrai si un jeton neuf est attendu) ; absent : aucun essai. */
  readonly rafraichirJeton?: () => Promise<boolean>;
  /** Alerte le chef (notification) quand le compte doit se reconnecter. */
  readonly alerter?: (titre: string, texte: string) => void;
  readonly urlApi: string;
  readonly fetch: typeof fetch;
  readonly suivi: SuiviSessionsClaude;
  readonly debutRequete: (membre: string) => Releve | null;
  readonly finRequete: (membre: string, debut: Releve | null, conso: Consommation, nouvelleSession: boolean) => void;
  readonly journal: Logger;
}

const VIDE: Consommation = { entree: 0, sortie: 0, modele: null };
const TYPE_JSON = 'application/json';

/** En-têtes envoyés à l'API : la liste blanche de l'invité, plus le jeton du chef et la bêta OAuth. */
export function entetesAmont(entetes: Record<string, string>, jeton: string): Record<string, string> {
  return {
    ...entetes,
    authorization: `Bearer ${jeton}`,
    'anthropic-beta': fusionnerBeta(entetes['anthropic-beta']),
    'anthropic-version': entetes['anthropic-version'] ?? VERSION_API,
    'content-type': entetes['content-type'] ?? TYPE_JSON,
  };
}

function cle(membre: string, ref: string): string {
  return `${membre}\u0000${ref}`;
}

export class ServeurClaude {
  private readonly enCours = new Map<string, AbortController>();

  constructor(private readonly p: PortServeurClaude) {}

  /** Une requête dont le corps est réuni : verdict, puis appel de l'API, réponse relayée et comptée. */
  async traiter(canal: EmetteurClaude, requete: ClaudeRequete, corps: Uint8Array): Promise<void> {
    const reglages = this.p.reglagesDe(canal.membre);
    const session = requete.entetes['x-claude-code-session-id'] ?? SANS_SESSION;
    const recentes = this.p.suivi.recentes(canal.membre);
    const verdict = verdictRequeteClaude({
      reglages,
      moi: this.p.moi(),
      methode: requete.methode,
      chemin: requete.chemin,
      corps: new TextDecoder().decode(corps),
      session,
      sessionsRecentes: recentes,
      part: reglages === null ? { ok: true } : this.p.partDe(canal.membre, reglages),
    });
    if (!verdict.ok) {
      this.p.journal.warn(
        { membre: canal.membre, statut: verdict.statut, raison: verdict.message },
        'relais Claude : requête refusée',
      );
      return this.refuser(canal, requete.ref, verdict.statut, verdict.type, verdict.message);
    }
    const jeton = await this.jetonValide();
    if (jeton === null) {
      // 403 : affiché tout de suite à l'invité ; un 5xx serait réessayé par Claude Code en silence pendant des minutes.
      return this.refuser(canal, requete.ref, 403, 'permission_error', 'le compte Claude du chef doit se reconnecter');
    }
    const nouvelle = !recentes.includes(session);
    this.p.suivi.noter(canal.membre, session);
    const debut = this.p.debutRequete(canal.membre);
    const conso = await this.appeler(canal, requete, corps, jeton);
    this.p.finRequete(canal.membre, debut, conso, nouvelle);
  }

  /** Le jeton du compte ; expiré, Claude Code le renouvelle une fois, puis il est relu. Toujours absent : alerte. */
  private async jetonValide(): Promise<string | null> {
    const jeton = this.p.jetonAbonnement();
    if (jeton !== null || this.p.rafraichirJeton === undefined) return jeton;
    const relu = (await this.p.rafraichirJeton()) ? this.p.jetonAbonnement() : null;
    if (relu === null) {
      this.p.journal.error('relais Claude : jeton du chef expiré et non renouvelé');
      this.p.alerter?.(
        'Compte Claude à reconnecter',
        'Le relais des invités n’a pas pu renouveler le jeton de ce compte : reconnecte-le dans Paramètres › Comptes.',
      );
    }
    return relu;
  }

  /** Coupe l'appel à l'API d'une requête de ce pair (`claude_annuler`). */
  annuler(membre: string, ref: string): void {
    this.enCours.get(cle(membre, ref))?.abort();
    this.enCours.delete(cle(membre, ref));
  }

  /** Coupe tous les appels d'un pair (lien perdu, révocation). */
  annulerTout(membre: string): void {
    for (const [k, controle] of [...this.enCours]) {
      if (!k.startsWith(`${membre}\u0000`)) continue;
      controle.abort();
      this.enCours.delete(k);
    }
  }

  /** Une erreur au format Anthropic, en réponse complète (en-têtes, corps en morceau, fin). */
  refuser(canal: EmetteurClaude, ref: string, statut: number, type: TypeErreurClaude, message: string): void {
    canal.envoyer({ t: 'claude_entete', ref, statut, entetes: { 'content-type': TYPE_JSON } });
    canal.envoyer({
      t: 'morceau',
      ref,
      rang: 0,
      corps: Buffer.from(erreurAnthropic(type, message)).toString('base64'),
    });
    canal.envoyer({ t: 'claude_fin', ref, morceaux: 1, ok: true });
  }

  private async appeler(
    canal: EmetteurClaude,
    requete: ClaudeRequete,
    corps: Uint8Array,
    jeton: string,
  ): Promise<Consommation> {
    const controle = new AbortController();
    this.enCours.set(cle(canal.membre, requete.ref), controle);
    try {
      const reponse = await this.p.fetch(`${this.p.urlApi}${requete.chemin}`, {
        method: 'POST',
        headers: entetesAmont(requete.entetes, jeton),
        body: corps,
        signal: controle.signal,
      });
      canal.envoyer({
        t: 'claude_entete',
        ref: requete.ref,
        statut: reponse.status,
        entetes: entetesReponse(reponse.headers),
      });
      return await this.relayer(canal, requete.ref, reponse, controle);
    } catch (erreur) {
      this.p.journal.error({ err: erreur, membre: canal.membre }, 'relais Claude : appel de l’API en échec');
      if (!controle.signal.aborted) this.refuser(canal, requete.ref, 502, 'api_error', 'l’API Claude ne répond pas');
      return VIDE;
    } finally {
      this.enCours.delete(cle(canal.membre, requete.ref));
    }
  }

  // Les morceaux partent au fil de l'arrivée ; la consommation se lit au passage, sans garder le contenu.
  private async relayer(
    canal: EmetteurClaude,
    ref: string,
    reponse: Response,
    controle: AbortController,
  ): Promise<Consommation> {
    const analyse = new AnalyseConsommation((reponse.headers.get('content-type') ?? '').includes('text/event-stream'));
    let rang = 0;
    try {
      for await (const bloc of reponse.body ?? []) {
        analyse.ajouter(bloc);
        for (let debut = 0; debut < bloc.byteLength; debut += OCTETS_MORCEAU_CLAUDE) {
          const tranche = Buffer.from(bloc.subarray(debut, debut + OCTETS_MORCEAU_CLAUDE)).toString('base64');
          if (!canal.envoyer({ t: 'morceau', ref, rang, corps: tranche }))
            throw new Error('canal fermé pendant le flux');
          rang += 1;
        }
      }
      canal.envoyer({ t: 'claude_fin', ref, morceaux: rang, ok: true });
    } catch (erreur) {
      controle.abort();
      this.p.journal.warn({ err: erreur, membre: canal.membre }, 'relais Claude : flux coupé en route');
      canal.envoyer({ t: 'claude_fin', ref, morceaux: rang, ok: false, raison: 'flux coupé en route' });
    }
    return analyse.bilan();
  }
}
