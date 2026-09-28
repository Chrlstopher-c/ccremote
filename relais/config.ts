// Responsabilité : la configuration du relais, lue exclusivement dans l'environnement (aucune valeur réelle dans le
// dépôt).
import { join } from 'node:path';

export interface ConfigRelais {
  readonly empreinteMotDePasse: string;
  readonly secretsPostes: ReadonlyMap<string, string>;
  readonly isolees: ReadonlySet<string>;
  readonly wol: ReadonlyMap<string, string>;
  readonly diffusionWol: string;
  readonly base: string;
  readonly portWeb: number;
  readonly portPostes: number;
  readonly web: string;
  readonly origines: ReadonlySet<string>;
}

// « a=x,b=y » → Map ; « a,b » → Set
function paires(v: string | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const i = p.indexOf('=');
    if (i > 0) m.set(p.slice(0, i), p.slice(i + 1));
  }
  return m;
}

function requis(nom: string): string {
  const v = process.env[nom];
  if (!v) throw new Error(`${nom} absent de l’environnement du relais`);
  return v;
}

export function chargerConfig(): ConfigRelais {
  const racine = join(import.meta.dir, '..');
  return {
    empreinteMotDePasse: requis('CCREMOTE_EMPREINTE_MOT_DE_PASSE'),
    secretsPostes: paires(requis('CCREMOTE_SECRETS_POSTES')),
    isolees: new Set(
      (process.env['CCREMOTE_MACHINES_ISOLEES'] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    wol: paires(process.env['CCREMOTE_WOL']),
    diffusionWol: process.env['CCREMOTE_DIFFUSION_WOL'] ?? '255.255.255.255',
    base: process.env['CCREMOTE_BASE'] ?? join(racine, '.donnees/relais.db'),
    portWeb: Number(process.env['CCREMOTE_PORT_WEB'] ?? 8766),
    portPostes: Number(process.env['CCREMOTE_PORT_POSTES'] ?? 8721),
    web: process.env['CCREMOTE_WEB'] ?? join(racine, 'bureau/dist'),
    origines: new Set(
      (process.env['CCREMOTE_ORIGINES'] ?? 'tauri://localhost,http://tauri.localhost,http://localhost:1420')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  };
}
