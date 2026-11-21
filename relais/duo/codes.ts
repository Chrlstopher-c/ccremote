// Responsabilité : les codes d'appairage du mode duo — usage unique, valables 10 min, brûlés après trop d'essais faux.
import { randomInt } from 'node:crypto';
import { ALPHABET_CODE, DUREE_CODE_MS, ESSAIS_CODE_MAX, LONGUEUR_CODE } from '../../commun/duo.ts';

export type VerdictCode = 'ok' | 'faux' | 'expire' | 'utilise';

interface CodeEmis {
  readonly expireA: number;
  utilise: boolean;
}

export class CodesAppairage {
  private readonly codes = new Map<string, CodeEmis>();
  private ratages = 0;

  constructor(private readonly maintenant: () => number) {}

  creer(): { code: string; expireLe: string } {
    this.purger();
    const code = genererCode();
    const expireA = this.maintenant() + DUREE_CODE_MS;
    this.codes.set(code, { expireA, utilise: false });
    this.ratages = 0;
    return { code, expireLe: new Date(expireA).toISOString() };
  }

  consommer(saisi: string): VerdictCode {
    this.purger();
    const entree = this.codes.get(saisi.trim().toUpperCase());
    if (!entree) return this.ratage();
    if (entree.utilise) return 'utilise';
    if (this.maintenant() >= entree.expireA) return 'expire';
    entree.utilise = true;
    return 'ok';
  }

  // Un code faux compte ; au bout de ESSAIS_CODE_MAX, plus aucun code en attente : il en faut un nouveau.
  private ratage(): VerdictCode {
    this.ratages += 1;
    if (this.ratages >= ESSAIS_CODE_MAX) this.codes.clear();
    return 'faux';
  }

  private purger(): void {
    const maintenant = this.maintenant();
    for (const [code, e] of this.codes) {
      if (maintenant >= e.expireA + DUREE_CODE_MS) this.codes.delete(code);
    }
  }
}

function genererCode(): string {
  let code = '';
  for (let i = 0; i < LONGUEUR_CODE; i++) code += ALPHABET_CODE[randomInt(ALPHABET_CODE.length)];
  return code;
}
