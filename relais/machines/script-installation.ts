// Responsabilité : le script d'installation du poste (bash, généré, exécuté une fois par installation) et l'unité
// systemd utilisateur qu'il écrit. Deux nommages : le poste Quart d'origine (quart-poste-distant, inchangé) et le poste
// Lanterne (lanterne-poste[-instance]), qui reprend les jetons Claude et les bornes du poste Quart déjà installé.
export const UNITE_POSTE = 'quart-poste-distant.service';

/** Noms distants d'un poste : unité, dossiers, socket tmux. Pour Lanterne, tout porte le suffixe d'instance. */
export interface Nommage {
  readonly unite: string;
  readonly dossierCode: string;
  readonly dossierConfig: string;
  readonly dossierDonnees: string;
  readonly socketTmux: string | null;
  readonly lanterne: boolean;
}

export const NOMMAGE_QUART: Nommage = {
  unite: UNITE_POSTE,
  dossierCode: '$HOME/.local/share/quart-poste/code',
  dossierConfig: '$HOME/.config/quart-poste',
  dossierDonnees: '$HOME/.local/share/quart-poste/donnees',
  socketTmux: null,
  lanterne: false,
};

const INSTANCE = /^[a-z0-9][a-z0-9-]{0,19}$/;

export function nommageLanterne(instance: string | null): Nommage {
  if (instance !== null && !INSTANCE.test(instance)) throw new Error(`instance invalide : ${instance}`);
  const suffixe = instance ? `-${instance}` : '';
  return {
    unite: `lanterne-poste${suffixe}.service`,
    dossierCode: `$HOME/.local/share/lanterne-poste${suffixe}/code`,
    dossierConfig: `$HOME/.config/lanterne-poste${suffixe}`,
    dossierDonnees: `$HOME/.local/share/lanterne-poste${suffixe}/donnees`,
    socketTmux: `lanterne${suffixe}`,
    lanterne: true,
  };
}

const ENTETE_BUS = `# Une session SSH non interactive n'a pas le bus de l'utilisateur : on le fixe à son emplacement standard.
export XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="\${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"`;

// Jetons Claude et bornes repris du poste Quart existant (son drop-in). Sans bornes existantes, les défauts Lanterne :
// petite machine (< 8 Go, Pi) 1 Go et 1,5 cœur ; sinon un quart de la mémoire (8 Go au plus), sans plafond de
// processeur — une session Claude avec tous ses serveurs MCP dépasse 1 Go (OOM en boucle sur la tour le 20/11).
const DROPIN = '"$HOME/.config/systemd/user/quart-poste-distant.service.d"';
const FILTRE_JETONS = "grep -iE '^EnvironmentFile=.*(token|jeton|claude)' | grep -v 'poste\\.env'";
const REGLAGES_LANTERNE = `JETONS=$(cat ${DROPIN}/*.conf 2>/dev/null | ${FILTRE_JETONS} || true)
BORNES=$(grep -hE '^(MemoryMax|MemorySwapMax|CPUQuota|Nice)=' ${DROPIN}/bornes-lanterne.conf 2>/dev/null || true)
[ -n "$BORNES" ] || { RAM_GO=$(( $(awk '/^MemTotal:/{print $2}' /proc/meminfo) / 1048576 )); if [ "$RAM_GO" -ge 8 ]; then M=$(( RAM_GO / 4 )); [ "$M" -gt 8 ] && M=8; BORNES=$(printf '%s\\n' "MemoryMax=$M"G 'MemorySwapMax=0' 'Nice=10'); else BORNES=$(printf '%s\\n' 'MemoryMax=1G' 'MemorySwapMax=0' 'CPUQuota=150%' 'Nice=10'); fi; }`;

function unite(id: string, n: Nommage): string {
  const titre = n.lanterne ? 'Lanterne' : 'Quart';
  const socket = n.socketTmux ? [`Environment=CCREMOTE_TMUX_SOCKET=${n.socketTmux}`] : [];
  const jetons = n.lanterne ? ['EnvironmentFile=-%h/.config/lanterne/claude-token.env', '$JETONS', '$BORNES'] : [];
  return [
    '[Unit]',
    `Description=${titre} — poste de la machine ${id} (installé par le relais)`,
    'After=network-online.target',
    '',
    '[Service]',
    `WorkingDirectory=${n.dossierCode}`,
    `EnvironmentFile=${n.dossierConfig}/poste.env`,
    `Environment=CCREMOTE_CONFIG_POSTE=${n.dossierConfig}/poste.json`,
    ...socket,
    'Environment=PATH=$HOME/.local/bin:$(dirname "$BUN"):/usr/local/bin:/usr/bin:/bin',
    'Environment=LANG=C.UTF-8',
    ...jetons,
    '',
    'ExecStart=$BUN run poste/bin.ts',
    'Restart=on-failure',
    'RestartSec=5',
    'KillMode=process',
    '',
    '[Install]',
    'WantedBy=default.target',
  ].join('\n');
}

/** Ligne d'avancement lue par le relais (étape courante) ; vide pour le poste d'origine, inchangé. */
function marque(n: Nommage, etape: string): string {
  return n.lanterne ? `echo '@etape ${etape}'` : '';
}

export function scriptInstallation(id: string, nommage: Nommage = NOMMAGE_QUART): string {
  const { dossierCode, dossierConfig, dossierDonnees, unite: nomUnite } = nommage;
  return `#!/usr/bin/env bash
# Installation du poste (machine ${id}) — généré par le relais, exécuté une fois par installation.
set -euo pipefail
${ENTETE_BUS}
systemctl --user show-environment >/dev/null 2>&1 \\
  || { echo 'bus systemd utilisateur injoignable (session ou loginctl enable-linger requis)' >&2; exit 5; }
ARCHIVE="$(cd "$(dirname "$0")/.." && pwd)"
BUN="$(command -v bun || true)"
[ -n "$BUN" ] || { echo 'bun absent : installer bun sur la machine' >&2; exit 4; }
command -v tmux >/dev/null || { echo 'tmux absent' >&2; exit 4; }
${nommage.lanterne ? REGLAGES_LANTERNE : ''}
mkdir -p "${dossierCode}"
rm -rf "${dossierCode}/poste" "${dossierCode}/commun"
cp -r "$ARCHIVE"/poste "$ARCHIVE"/commun "$ARCHIVE"/package.json "$ARCHIVE"/bun.lock "${dossierCode}/"
${marque(nommage, 'bun install')}
cd "${dossierCode}" && "$BUN" install --frozen-lockfile --production >&2
${marque(nommage, 'unité')}
mkdir -p "${dossierConfig}" "${dossierDonnees}" "$HOME/.config/systemd/user"
chmod 700 "${dossierConfig}"
install -m 600 "$ARCHIVE/install/poste.json" "${dossierConfig}/poste.json"
install -m 600 "$ARCHIVE/install/poste.env" "${dossierConfig}/poste.env"
cat > "$HOME/.config/systemd/user/${nomUnite}" <<UNITE
${unite(id, nommage)}
UNITE
systemctl --user daemon-reload
systemctl --user enable "${nomUnite}" >/dev/null
${marque(nommage, 'démarrage')}
systemctl --user restart "${nomUnite}"
loginctl show-user "$(id -un)" -p Linger 2>/dev/null | grep -q 'Linger=yes' \\
  || echo 'avertissement : linger désactivé, le poste ne redémarre pas sans session (loginctl enable-linger)' >&2
echo "poste installé : ${nomUnite}"
`;
}
