// Responsabilité : installer le poste Quart sur une machine SSH — archive du code et des fichiers de configuration,
// puis script distant (bun install, configuration 600, unité systemd utilisateur). Le secret ne sort jamais sur la
// ligne de commande : il voyage dans l'archive, dans un dossier temporaire 700 supprimé à la fin.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnexionSsh, Ssh } from './ssh.ts';

export const UNITE_POSTE = 'quart-poste-distant.service';
const DOSSIER_CODE = '$HOME/.local/share/quart-poste/code';
const DOSSIER_CONFIG = '$HOME/.config/quart-poste';

/** Fichiers du code envoyés tels quels (le poste et ses dépendances de production). */
export const ELEMENTS_CODE = ['poste', 'commun', 'package.json', 'bun.lock'] as const;

export function scriptInstallation(id: string): string {
  return `#!/usr/bin/env bash
# Installation du poste Quart (machine ${id}) — généré par le relais, exécuté une fois par installation.
set -euo pipefail
# Une session SSH non interactive n'a pas le bus de l'utilisateur : on le fixe à son emplacement standard.
export XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="\${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
systemctl --user show-environment >/dev/null 2>&1 \\
  || { echo 'bus systemd utilisateur injoignable (session ou loginctl enable-linger requis)' >&2; exit 5; }
ARCHIVE="$(cd "$(dirname "$0")/.." && pwd)"
BUN="$(command -v bun || true)"
[ -n "$BUN" ] || { echo 'bun absent : installer bun sur la machine' >&2; exit 4; }
command -v tmux >/dev/null || { echo 'tmux absent' >&2; exit 4; }
mkdir -p "${DOSSIER_CODE}"
rm -rf "${DOSSIER_CODE}/poste" "${DOSSIER_CODE}/commun"
cp -r "$ARCHIVE"/poste "$ARCHIVE"/commun "$ARCHIVE"/package.json "$ARCHIVE"/bun.lock "${DOSSIER_CODE}/"
cd "${DOSSIER_CODE}" && "$BUN" install --frozen-lockfile --production >&2
mkdir -p "${DOSSIER_CONFIG}" "$HOME/.local/share/quart-poste/donnees" "$HOME/.config/systemd/user"
chmod 700 "${DOSSIER_CONFIG}"
install -m 600 "$ARCHIVE/install/poste.json" "${DOSSIER_CONFIG}/poste.json"
install -m 600 "$ARCHIVE/install/poste.env" "${DOSSIER_CONFIG}/poste.env"
cat > "$HOME/.config/systemd/user/${UNITE_POSTE}" <<UNITE
[Unit]
Description=Quart — poste de la machine ${id} (installé par le relais)
After=network-online.target

[Service]
WorkingDirectory=${DOSSIER_CODE}
EnvironmentFile=${DOSSIER_CONFIG}/poste.env
Environment=CCREMOTE_CONFIG_POSTE=${DOSSIER_CONFIG}/poste.json
Environment=PATH=$HOME/.local/bin:$(dirname "$BUN"):/usr/local/bin:/usr/bin:/bin
Environment=LANG=C.UTF-8
ExecStart=$BUN run poste/bin.ts
Restart=on-failure
RestartSec=5
KillMode=process

[Install]
WantedBy=default.target
UNITE
systemctl --user daemon-reload
systemctl --user enable "${UNITE_POSTE}" >/dev/null
systemctl --user restart "${UNITE_POSTE}"
loginctl show-user "$(id -un)" -p Linger 2>/dev/null | grep -q 'Linger=yes' \\
  || echo 'avertissement : linger désactivé, le poste ne redémarre pas sans session (loginctl enable-linger)' >&2
echo "poste installé : ${UNITE_POSTE}"
`;
}

export interface FichiersPoste {
  readonly posteJson: string;
  readonly posteEnv: string;
}

/** La config du poste : sans secret (il est dans poste.env). */
export function fichiersPoste(
  id: string,
  description: string,
  relais: string,
  secret: string,
  api?: { readonly url: string; readonly jeton: string },
): FichiersPoste {
  const config = {
    machine: id,
    relais,
    description: description || id,
    racines: ['~'],
    comptes: { principal: null },
    donnees: '~/.local/share/quart-poste/donnees',
  };
  return {
    posteJson: `${JSON.stringify(config, null, 2)}\n`,
    posteEnv: `CCREMOTE_SECRET_POSTE=${secret}\n${api ? `CCREMOTE_URL_API=${api.url}\nCCREMOTE_JETON_API=${api.jeton}\n` : ''}`,
  };
}

/** Dossier temporaire 700 contenant install/ (script, config, secret) ; à supprimer par l'appelant. */
export async function preparerDossier(id: string, fichiers: FichiersPoste): Promise<string> {
  const racine = await mkdtemp(join(tmpdir(), 'quart-installation-'));
  const install = join(racine, 'install');
  await mkdir(install, { mode: 0o700 });
  await writeFile(join(install, 'installer.sh'), scriptInstallation(id), { mode: 0o700 });
  await writeFile(join(install, 'poste.json'), fichiers.posteJson, { mode: 0o600 });
  await writeFile(join(install, 'poste.env'), fichiers.posteEnv, { mode: 0o600 });
  return racine;
}

/** Archive tar.gz : le code du poste à la racine de l'archive, puis install/ (script et configuration). */
export async function archiver(racineCode: string, dossierInstall: string): Promise<Uint8Array> {
  const processus = Bun.spawn(
    ['tar', '-czf', '-', '-C', racineCode, ...ELEMENTS_CODE, '-C', dossierInstall, 'install'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [octets, erreurs, code] = await Promise.all([
    new Response(processus.stdout).arrayBuffer(),
    new Response(processus.stderr).text(),
    processus.exited,
  ]);
  if (code !== 0) throw new Error(`tar a échoué : ${erreurs.trim()}`);
  return new Uint8Array(octets);
}

export function commandeInstallation(): string {
  return `t=$(mktemp -d) && tar -xzf - -C "$t" && bash "$t/install/installer.sh"; c=$?; rm -rf "$t"; exit $c`;
}

export interface ResultatInstallation {
  readonly ok: boolean;
  readonly sortie: string;
}

export async function installerPoste(
  ssh: Ssh,
  c: ConnexionSsh,
  archive: Uint8Array,
): Promise<ResultatInstallation> {
  const r = await ssh.executer(c, commandeInstallation(), archive, 900_000);
  const fin = `${r.sortie}${r.erreurs}`.trim().split('\n').slice(-30).join('\n');
  return { ok: r.code === 0, sortie: fin };
}

