import { describe, expect, test } from 'bun:test';
import { ErreurParametres, dossierDonneesDefaut, lireParametres } from './parametres.ts';

const complet = {
  LANTERNE_MOTEUR_PORT_WEB: '41001',
  LANTERNE_MOTEUR_PORT_POSTES: '41002',
  LANTERNE_MOTEUR_JETON: 'jeton-factice',
};

describe('lecture des paramètres du moteur intégré', () => {
  test('lit les ports et le jeton, données par défaut sous ~/.local/share', () => {
    const p = lireParametres(complet, '/home/u');
    expect(p.portWeb).toBe(41001);
    expect(p.portPostes).toBe(41002);
    expect(p.donnees).toBe('/home/u/.local/share/lanterne/moteur');
    expect(p.socketTmux).toBe('lanterne');
    expect(p.codePoste).toBeUndefined();
    expect(p.relaisDistant).toBeNull();
  });

  test('un relais distant (poste seul) se lit avec son jeton de poste, et une configuration partielle est refusée', () => {
    const distant = { ...complet, LANTERNE_RELAIS_DISTANT: 'wss://relais.exemple.test/poste', LANTERNE_RELAIS_DISTANT_JETON: 'j' };
    expect(lireParametres(distant, '/home/u').relaisDistant).toEqual({ url: 'wss://relais.exemple.test/poste', jeton: 'j' });
    expect(() => lireParametres({ ...complet, LANTERNE_RELAIS_DISTANT: 'wss://x.test/poste' })).toThrow(ErreurParametres);
  });

  test('XDG_DATA_HOME et LANTERNE_MOTEUR_DONNEES passent avant le défaut', () => {
    expect(dossierDonneesDefaut({ XDG_DATA_HOME: '/d' }, '/home/u')).toBe('/d/lanterne/moteur');
    expect(lireParametres({ ...complet, LANTERNE_MOTEUR_DONNEES: '/x' }).donnees).toBe('/x');
  });

  test('refuse un port absent ou hors plage, et un jeton absent', () => {
    expect(() => lireParametres({ ...complet, LANTERNE_MOTEUR_PORT_WEB: '0' })).toThrow(ErreurParametres);
    expect(() => lireParametres({ ...complet, LANTERNE_MOTEUR_PORT_POSTES: undefined })).toThrow(ErreurParametres);
    expect(() => lireParametres({ ...complet, LANTERNE_MOTEUR_JETON: '' })).toThrow(ErreurParametres);
  });
});
