// Responsabilité : tests de l'étiquetage des tunnels et de la validation des réponses des postes.
import { describe, expect, test } from 'bun:test';
import type { ProcessusPoste } from '../../commun/entretien.ts';
import { etiqueterTunnels, lireChantiersRecus, lireProcessusRecus } from './processus.ts';

const base: ProcessusPoste = {
  pid: 1,
  debut: '1',
  ppid: 0,
  commande: 'Tunnel SSH',
  role: 'tunnel',
  session: null,
  depuis: '',
  memoire: 0,
  reste: false,
};

describe('étiquetage des tunnels', () => {
  test('le tunnel de la machine prend son nom ; les autres processus gardent leur commande', () => {
    const liste: ProcessusPoste[] = [base, { ...base, pid: 2, role: 'autre', commande: 'git status' }];
    const r = etiqueterTunnels(liste, [{ id: 'tour', pid: 1 }]);
    expect(r[0]?.commande).toBe('Tunnel SSH vers tour');
    expect(r[1]?.commande).toBe('git status');
  });

  test('un tunnel inconnu du relais reste « Tunnel SSH »', () => {
    expect(etiqueterTunnels([base], [])[0]?.commande).toBe('Tunnel SSH');
  });
});

describe('réponses des postes', () => {
  test('forme valide : processus et sessions tmux ; forme invalide : null', () => {
    const bonne = { processus: [base], tmux: [{ nom: 'claude-x', session: null, depuis: null, reste: false }] };
    expect(lireProcessusRecus(bonne)?.processus).toHaveLength(1);
    expect(lireProcessusRecus({ processus: 'n’importe quoi' })).toBeNull();
    expect(lireChantiersRecus({ chantiers: [{ fichier: 'a.json' }] })).toBeNull();
  });
});
