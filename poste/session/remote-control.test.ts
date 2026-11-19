import { describe, expect, test } from 'bun:test';
import { attendre, deconnexionConfirmee, deplacementVersDeconnexion, estPret, urlDeControle } from './remote-control.ts';
import { commandeClaude } from './lanceur.ts';
import { consignesAvecPresentation, consignesSansPresentation, BLOC_PRESENTATION } from './consignes.ts';

// Écrans relevés sur le TUI réel (Claude Code 2.1.323, `/remote-control` tapé dans une session jetable).
const ECRAN_ACTIF = `❯ /remote-control
  /remote-control is active · Continue here, on your phone, or at https://claude.ai/code/session_011H3TDc77JH6CVWNi9uiAbB

❯
  Haiku 5.5 high  ·  5h ━━━━━━━━ 44%
  ⏵⏵ bypass permissions on (shift+tab to cycle)`;

const ECRAN_DIALOGUE = `❯ /remote-control
  /remote-control is active · Continue here
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
   Remote Control
   This session is available in the Claude mobile app and at https://claude.ai/code/session_011H3TDc77JH6CVWNi9uiAbB.
     Disconnect this session
     Show QR code   Scan with your phone to open this session
   ❯ Continue
   Enter to select · Esc to continue`;

describe('lecture de l’écran Remote Control', () => {
  test('l’URL de la session connectée est relevée sur la ligne « is active »', () => {
    expect(urlDeControle(ECRAN_ACTIF)).toBe('https://claude.ai/code/session_011H3TDc77JH6CVWNi9uiAbB');
  });

  test('l’URL repliée sur la ligne suivante (pane de 80 colonnes) est relevée', () => {
    const replie = '❯ /remote-control\n  /remote-control is active · Continue here, on your phone, or at\n' +
      '  https://claude.ai/code/session_011H3TDc77JH6CVWNi9uiAbB\n';
    expect(urlDeControle(replie)).toBe('https://claude.ai/code/session_011H3TDc77JH6CVWNi9uiAbB');
  });

  test('pas d’URL avant l’activation, ni dans le dialogue qui n’annonce pas « is active »', () => {
    expect(urlDeControle('❯ Try "refactor <filepath>"')).toBeNull();
    expect(urlDeControle(ECRAN_DIALOGUE.replace('/remote-control is active · Continue here', 'x'))).toBeNull();
  });

  test('le TUI est prêt quand son invite et sa barre de pied sont à l’écran', () => {
    expect(estPret('❯ Try "refactor <filepath>"\n  ⏵⏵ bypass permissions on')).toBe(true);
    expect(estPret('  en train de travailler…')).toBe(false);
  });

  test('le curseur du dialogue est ramené sur « Disconnect this session » (Haut positif, Bas négatif)', () => {
    expect(deplacementVersDeconnexion(ECRAN_DIALOGUE)).toBe(2);
    expect(deplacementVersDeconnexion(ECRAN_DIALOGUE.replace('❯ Continue', '  Continue').replace('     Disconnect', '   ❯ Disconnect'))).toBe(0);
    expect(deplacementVersDeconnexion(ECRAN_ACTIF)).toBeNull();
  });

  test('la confirmation de déconnexion est reconnue', () => {
    expect(deconnexionConfirmee('  ⎿  Remote Control disconnected.')).toBe(true);
    expect(deconnexionConfirmee(ECRAN_ACTIF)).toBe(false);
  });
});

describe('attendre', () => {
  test('rend la première valeur non nulle', async () => {
    let appels = 0;
    const valeur = await attendre(async () => (++appels < 3 ? null : 'ok'), 5_000);
    expect(valeur).toBe('ok');
    expect(appels).toBe(3);
  });

  test('rend null au délai', async () => {
    expect(await attendre(async () => null, 50)).toBeNull();
  });

  test('une valeur 0 est une valeur (et non une absence)', async () => {
    expect(await attendre(async () => 0, 50)).toBe(0);
  });
});

describe('réglages de la reprise TUI', () => {
  const base = { sessionId: 'abc', titre: 't', consignes: 'c', reprise: true } as const;

  test('une session bypass garde --dangerously-skip-permissions et son modèle', () => {
    const cmd = commandeClaude({ ...base, modele: 'haiku', mode: 'bypassPermissions', effort: 'high' });
    expect(cmd).toContain('--dangerously-skip-permissions');
    expect(cmd).not.toContain('--permission-mode');
    expect(cmd.slice(cmd.indexOf('--model'), cmd.indexOf('--model') + 2)).toEqual(['--model', 'haiku']);
    expect(cmd.slice(cmd.indexOf('--effort'), cmd.indexOf('--effort') + 2)).toEqual(['--effort', 'high']);
    expect(cmd.slice(-2)).toEqual(['--resume', 'abc']);
  });

  test('un autre mode de permission passe au CLI et retire le bypass', () => {
    const cmd = commandeClaude({ ...base, modele: null, mode: 'acceptEdits' });
    expect(cmd).not.toContain('--dangerously-skip-permissions');
    expect(cmd.slice(cmd.indexOf('--permission-mode'), cmd.indexOf('--permission-mode') + 2)).toEqual([
      '--permission-mode',
      'acceptEdits',
    ]);
    expect(cmd).not.toContain('--effort');
  });

  test('sans réglage transmis, la commande reste celle d’avant (aucun --model)', () => {
    expect(commandeClaude({ ...base, modele: null })).not.toContain('--model');
  });
});

describe('bloc de présentation des consignes', () => {
  test('le TUI n’a pas le bloc des outils de présentation, le SDK le retrouve', () => {
    const avec = `Entête\n\n${BLOC_PRESENTATION}\n\nRègles`;
    const sans = consignesSansPresentation(avec);
    expect(sans).not.toContain('## Présenter des fichiers');
    expect(sans).toContain('Entête');
    expect(sans).toContain('Règles');
    expect(consignesAvecPresentation(sans)).toContain(BLOC_PRESENTATION);
    expect(consignesAvecPresentation(avec)).toBe(avec);
  });
});
