// Responsabilité : tester une machine configurée — SSH joignable, Claude Code, tmux, bun, poste Quart connecté.
// Chaque étape est indépendante : une étape en échec n'empêche pas de lire les suivantes.
import type { ConnexionSsh, Ssh } from './ssh.ts';
import { messageSsh } from './dossiers.ts';

export interface Etape {
  readonly ok: boolean;
  readonly detail: string;
}

export interface RapportTest {
  readonly ssh: Etape;
  readonly claude: Etape;
  readonly tmux: Etape;
  readonly bun: Etape;
  readonly poste: Etape;
}

// Même ordre de recherche que le poste (lanceur.ts) : ~/.bun/bin, ~/.local/bin, puis le PATH de la session SSH.
const SCRIPT_TEST = [
  `printf 'ssh=ok\\n'`,
  `for c in claude tmux bun; do`,
  `  p=""; for d in "$HOME/.bun/bin" "$HOME/.local/bin"; do [ -x "$d/$c" ] && p="$d/$c" && break; done;`,
  `  [ -n "$p" ] || p=$(command -v "$c" 2>/dev/null || true);`,
  `  if [ -n "$p" ]; then v=$("$p" --version 2>/dev/null | head -n1); printf '%s=oui %s\\n' "$c" "$v";`,
  `  else printf '%s=non\\n' "$c"; fi;`,
  `done`,
].join('\n');

/** Lit les lignes `cle=valeur` du script de test. */
export function lireRapport(sortie: string): Map<string, string> {
  const valeurs = new Map<string, string>();
  for (const ligne of sortie.split('\n')) {
    const i = ligne.indexOf('=');
    if (i > 0) valeurs.set(ligne.slice(0, i), ligne.slice(i + 1).trim());
  }
  return valeurs;
}

function etapeOutil(valeurs: Map<string, string>, nom: string): Etape {
  const v = valeurs.get(nom) ?? '';
  return v.startsWith('oui') ? { ok: true, detail: v.slice(3).trim() || 'présent' } : { ok: false, detail: 'absent' };
}

export async function testerMachine(
  ssh: Ssh,
  c: ConnexionSsh,
  posteEnLigne: boolean,
  posteInstalle: boolean,
): Promise<RapportTest> {
  const r = await ssh.executer(c, SCRIPT_TEST, null, 30_000);
  const valeurs = lireRapport(r.sortie);
  const ssh_ok = r.code === 0 && valeurs.get('ssh') === 'ok';
  const poste: Etape = posteEnLigne
    ? { ok: true, detail: 'connecté au relais' }
    : { ok: false, detail: posteInstalle ? 'installé, hors ligne' : 'non installé' };
  return {
    ssh: ssh_ok ? { ok: true, detail: 'connexion ok' } : { ok: false, detail: messageSsh(r.code, r.erreurs, r.delaiDepasse) },
    claude: ssh_ok ? etapeOutil(valeurs, 'claude') : { ok: false, detail: 'non vérifié' },
    tmux: ssh_ok ? etapeOutil(valeurs, 'tmux') : { ok: false, detail: 'non vérifié' },
    bun: ssh_ok ? etapeOutil(valeurs, 'bun') : { ok: false, detail: 'non vérifié' },
    poste,
  };
}
