import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOMMAGE_QUART, nommageLanterne, scriptInstallation, UNITE_POSTE } from './script-installation.ts';

const ID = 'pi';

describe('nommage du poste', () => {
  test('sans instance : noms Lanterne nus', () => {
    const n = nommageLanterne(null);
    expect(n.unite).toBe('lanterne-poste.service');
    expect(n.socketTmux).toBe('lanterne');
    expect(n.dossierCode).toBe('$HOME/.local/share/lanterne-poste/code');
    expect(n.dossierConfig).toBe('$HOME/.config/lanterne-poste');
  });

  test('instance banc : tous les noms portent le suffixe', () => {
    const n = nommageLanterne('banc');
    expect(n.unite).toBe('lanterne-poste-banc.service');
    expect(n.socketTmux).toBe('lanterne-banc');
    expect(n.dossierDonnees).toBe('$HOME/.local/share/lanterne-poste-banc/donnees');
  });

  test('une instance hors motif est refusée (elle finit dans une commande distante)', () => {
    expect(() => nommageLanterne('banc; rm -rf ~')).toThrow();
    expect(() => nommageLanterne('Banc')).toThrow();
  });
});

describe('script d’installation Lanterne', () => {
  const script = scriptInstallation(ID, nommageLanterne('banc'));

  test('unité, dossiers et socket par instance ; jamais le nom Quart', () => {
    expect(script).toContain('UNITE\n');
    expect(script).toContain('cat > "$HOME/.config/systemd/user/lanterne-poste-banc.service"');
    expect(script).toContain('systemctl --user restart "lanterne-poste-banc.service"');
    expect(script).toContain('Environment=CCREMOTE_TMUX_SOCKET=lanterne-banc');
    expect(script).toContain('WorkingDirectory=$HOME/.local/share/lanterne-poste-banc/code');
    expect(script).not.toContain(`${UNITE_POSTE}\nUNITE`);
  });

  test('jeton Claude en EnvironmentFile optionnel ; jetons et bornes repris du poste Quart existant', () => {
    expect(script).toContain('EnvironmentFile=-%h/.config/lanterne/claude-token.env');
    expect(script).toContain('\n$JETONS\n$BORNES\n');
    expect(script).toContain('bornes-lanterne.conf');
    expect(script).toContain("'MemoryMax=1G' 'MemorySwapMax=0' 'CPUQuota=150%' 'Nice=10'");
  });

  test('marqueurs d’étape lus par le relais, dans l’ordre', () => {
    const marques = script.split('\n').filter((l) => l.startsWith("echo '@etape ")).map((l) => l.slice(13, -1));
    expect(marques).toEqual(['bun install', 'unité', 'démarrage']);
  });

  test('aucun secret dans le script ; syntaxe bash valide', () => {
    expect(script).not.toMatch(/CCREMOTE_SECRET/);
    const fichier = join(mkdtempSync(join(tmpdir(), 'script-test-')), 'installer.sh');
    writeFileSync(fichier, script);
    expect(() => execFileSync('bash', ['-n', fichier])).not.toThrow();
  });

  test('les réglages repris : jetons filtrés (pas le poste.env Quart), bornes du drop-in ou défauts', () => {
    const racine = mkdtempSync(join(tmpdir(), 'reglages-test-'));
    const dropin = join(racine, '.config/systemd/user/quart-poste-distant.service.d');
    mkdirSync(dropin, { recursive: true });
    const jeton = [
      '[Service]',
      'EnvironmentFile=-%h/.config/quart-poste/claude-token.env',
      'EnvironmentFile=%h/.config/quart-poste/poste.env',
    ].join('\n');
    writeFileSync(join(dropin, 'jeton.conf'), `${jeton}\n`);
    const lignes = script.split('\n');
    const debut = lignes.findIndex((l) => l.startsWith('JETONS='));
    const fin = lignes.findIndex((l) => l.startsWith('[ -n "$BORNES" ]'));
    const reglages = lignes.slice(debut, fin + 1).join('\n');
    const sortie = execFileSync('bash', ['-c', `${reglages}\nprintf '%s\\n' "$JETONS" "---" "$BORNES"`], {
      env: { PATH: process.env['PATH'] ?? '', HOME: racine },
    }).toString();
    expect(sortie).toContain('EnvironmentFile=-%h/.config/quart-poste/claude-token.env');
    expect(sortie).not.toContain('poste.env');
    expect(sortie).toContain('MemoryMax=1G');
  });
});

describe('script d’installation du poste d’origine (inchangé)', () => {
  const script = scriptInstallation(ID, NOMMAGE_QUART);

  test('unité quart-poste-distant, sans socket ni jetons Lanterne', () => {
    expect(script).toContain(UNITE_POSTE);
    expect(script).not.toContain('CCREMOTE_TMUX_SOCKET');
    expect(script).not.toContain('claude-token.env');
    expect(script).toContain('"$BUN" install --frozen-lockfile --production');
    expect(script).not.toContain('@etape');
  });
});
