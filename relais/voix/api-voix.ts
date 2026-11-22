// Responsabilité : la synthèse vocale du mode vocal de l'iPhone — une phrase → son audio. Le nœud qui a le service
// de voix (la tour : LANTERNE_VOIX_URL, boucle locale) l'appelle ; un autre nœud relaie la demande à ses pairs en
// ligne (geste `voix` du nœud, `local=1` : jamais relayé plus loin). Le premier pair qui répond est retenu.
// `?flux=1` : en local, l'audio part au fil de la génération (PCM 24 kHz, audio/L16) ; relayé : le MP3 entier.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { erreur, lireCorps } from '../clients/http.ts';

const DELAI_SYNTHESE_MS = 20_000;
const TEXTE_MAX = 600;
const TYPE_PCM = 'audio/L16;rate=24000;channels=1';
const CorpsVoix = z.object({ texte: z.string().min(1).max(4000) });

/** Adresse du service de voix de cette machine : LANTERNE_VOIX_URL, sinon `~/.config/ccremote/voix.url`. */
export function urlVoix(env: Record<string, string | undefined>, dossier = join(homedir(), '.config/ccremote')): string | null {
  const brute = env['LANTERNE_VOIX_URL'] ?? lireFichier(join(dossier, 'voix.url'));
  const url = brute?.trim().replace(/\/+$/, '');
  return url && /^https?:\/\//.test(url) ? url : null;
}

function lireFichier(chemin: string): string | undefined {
  try {
    return readFileSync(chemin, 'utf8');
  } catch {
    return undefined;
  }
}

/** Ce que l'API voix attend de la fédération : relayer la demande à un pair (null : aucun pair n'a de voix). */
export interface PairsVoix {
  voixDesPairs(corps: string): Promise<Response | null>;
}

export class ApiVoix {
  constructor(
    private readonly url: string | null,
    private readonly pairs: PairsVoix,
    private readonly journal: Logger,
  ) {}

  async synthese(req: Request): Promise<Response> {
    const corps = await lireCorps(req, CorpsVoix);
    if (corps instanceof Response) return corps;
    const texte = corps.texte.trim();
    if (!texte) return erreur('texte vide', 400);
    const texteBref = texte.slice(0, TEXTE_MAX);
    const params = new URL(req.url).searchParams;
    if (this.url) return params.get('flux') === '1' ? this.localeFlux(texteBref) : this.locale(texteBref);
    if (params.get('local') === '1') return erreur('pas de voix sur ce nœud', 503);
    const relayee = await this.pairs.voixDesPairs(JSON.stringify({ texte: texteBref }));
    return relayee ?? erreur('aucune machine du réseau ne sait parler', 503);
  }

  private async locale(texte: string): Promise<Response> {
    try {
      const reponse = await this.appeler(JSON.stringify({ texte }));
      const audio = await reponse.arrayBuffer();
      if (!reponse.ok) return erreur('synthèse en échec', 503);
      return new Response(audio, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    } catch (err) {
      this.journal.error({ err }, 'voix : service de synthèse injoignable');
      return erreur('service de voix injoignable', 503);
    }
  }

  /** Le corps part tel que le service l'émet : chaque morceau est relayé dès qu'il arrive. */
  private async localeFlux(texte: string): Promise<Response> {
    try {
      const reponse = await this.appeler(JSON.stringify({ texte, flux: true }));
      if (!reponse.ok || !reponse.body) {
        await reponse.body?.cancel();
        return erreur('synthèse en échec', 503);
      }
      return new Response(reponse.body, { status: 200, headers: { 'content-type': TYPE_PCM } });
    } catch (err) {
      this.journal.error({ err }, 'voix : service de synthèse injoignable (flux)');
      return erreur('service de voix injoignable', 503);
    }
  }

  private appeler(corps: string): Promise<Response> {
    return fetch(`${this.url}/synthese`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: corps,
      signal: AbortSignal.timeout(DELAI_SYNTHESE_MS),
    });
  }
}
