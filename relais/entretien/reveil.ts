// Responsabilité : réveiller une machine éteinte — MAC connue (env ou dernier réseau relevé), envoi délégué à un poste
// en ligne du même réseau, sinon envoi depuis le relais. Le banc (CCREMOTE_REVEIL_FACTICE) écrit au lieu d'envoyer.
import type { Logger } from 'pino';
import type { ReponsePoste } from '../parc/postes.ts';
import { envoyerReveil } from '../../commun/reveil.ts';
import type { ReseauxConnus } from './reseaux.ts';

export const PAR_RELAIS = 'relais';

export interface EnvoiDelegue {
  readonly mac: string;
  readonly diffusion: string;
}

export interface DependancesReveil {
  readonly wol: ReadonlyMap<string, string>;
  readonly diffusionWol: string;
  readonly reseaux: ReseauxConnus;
  readonly envoyerPar: (poste: string, envoi: EnvoiDelegue) => Promise<ReponsePoste>;
  readonly factice: string | undefined;
  readonly journal: Logger;
}

export interface ResultatReveil {
  readonly ok: boolean;
  readonly par?: string;
  readonly erreur?: string;
}

/** Un poste en ligne (autre que la cible) dont le réseau a la même diffusion : il envoie le paquet à sa place. */
export function choisirDelegue(
  cible: string,
  diffusion: string,
  candidats: readonly string[],
  diffusionDe: (id: string) => string | null,
): string | null {
  return candidats.find((id) => id !== cible && diffusionDe(id) === diffusion) ?? null;
}

export class Reveil {
  constructor(private readonly d: DependancesReveil) {}

  /** La MAC à réveiller : celle de la configuration, sinon la dernière relevée. */
  macDe(id: string): string | null {
    return this.d.wol.get(id) ?? this.d.reseaux.de(id)?.mac ?? null;
  }

  /** La diffusion du réseau de la machine : relevée, sinon celle de la configuration. */
  diffusionDe(id: string): string {
    return this.d.reseaux.de(id)?.diffusion ?? this.d.diffusionWol;
  }

  /** Les machines dont le réveil est possible (MAC configurée ou relevée). */
  possibles(): string[] {
    return [...new Set([...this.d.wol.keys(), ...this.d.reseaux.ids()])];
  }

  /** Le réveil possible, et le poste qui relaierait le paquet (null : le relais l'envoie lui-même). */
  pour(id: string, candidats: readonly string[]): { possible: boolean; relaisPar: string | null } {
    const possible = this.macDe(id) !== null;
    const relaisPar = possible ? this.delegue(id, candidats) : null;
    return { possible, relaisPar };
  }

  async reveiller(id: string, candidats: readonly string[]): Promise<ResultatReveil> {
    const mac = this.macDe(id);
    if (!mac) return { ok: false, erreur: `${id} ne se réveille pas à distance` };
    const diffusion = this.diffusionDe(id);
    const delegue = this.delegue(id, candidats);
    if (delegue) {
      const r = await this.d.envoyerPar(delegue, { mac, diffusion });
      return r.ok ? { ok: true, par: delegue } : { ok: false, erreur: r.erreur ?? 'réveil refusé par le poste' };
    }
    try {
      await envoyerReveil({ mac, diffusion, par: PAR_RELAIS }, this.d.factice, this.d.journal);
      return { ok: true, par: PAR_RELAIS };
    } catch {
      return { ok: false, erreur: 'réveil impossible' };
    }
  }

  private delegue(id: string, candidats: readonly string[]): string | null {
    return choisirDelegue(id, this.diffusionDe(id), candidats, (x) => this.d.reseaux.de(x)?.diffusion ?? null);
  }
}
