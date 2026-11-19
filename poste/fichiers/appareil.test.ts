import { describe, expect, test } from 'bun:test';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import { estAppareil } from './appareil.ts';

const commande = (kind: string): CommandeRelais =>
  ({ kind, id: 'c1', sessionId: 's1' }) as unknown as CommandeRelais;

describe('estAppareil', () => {
  test('les commandes de fichiers et de terminaux sont de l’appareil', () => {
    expect(estAppareil(commande('fichiers_lister'))).toBe(true);
    expect(estAppareil(commande('fichier_lire'))).toBe(true);
    expect(estAppareil(commande('dossier_creer'))).toBe(true);
    expect(estAppareil(commande('terminal_ouvrir'))).toBe(true);
  });

  test('fichier_session est une commande de session, pas de l’appareil (sinon « undefined is not an object »)', () => {
    expect(estAppareil(commande('fichier_session'))).toBe(false);
  });
});
