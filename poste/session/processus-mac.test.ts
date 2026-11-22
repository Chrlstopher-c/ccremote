// Responsabilité : tests de l'état d'un processus macOS (nom, binaire, TMUX) construit à partir de ps.
import { describe, expect, test } from 'bun:test';
import { etatDepuisPs } from './processus-mac.ts';

describe('état d’un processus macOS', () => {
  test('nom, premier mot de la commande comme binaire, démarrage repris tel quel', () => {
    const binaire = '/Users/x/.local/share/claude/versions/2.1.325';
    const etat = etatDepuisPs('2.1.325', `${binaire} -p`, '123456', '');
    expect(etat).toEqual({ comm: '2.1.325', exe: binaire, demarrage: '123456', enTmux: false });
  });

  test('TMUX repéré dans l’environnement brut (ps -E), pas un simple texte qui le contient', () => {
    const avec = etatDepuisPs('claude', '/bin/claude', '1', 'HOME=/Users/x TMUX=/tmp/tmux-501/claude,12,0 PATH=/bin');
    const sans = etatDepuisPs('claude', '/bin/claude', '1', 'HOME=/Users/x XTMUX=faux');
    expect(avec.enTmux).toBe(true);
    expect(sans.enTmux).toBe(false);
  });
});
