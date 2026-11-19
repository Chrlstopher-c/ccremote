import { describe, expect, test } from 'bun:test';
import { type ParametresEnvironnement, construireEnvironnement, contenuPosteJson } from './environnement.ts';

const base: ParametresEnvironnement = {
  donnees: '/d/moteur',
  portWeb: 41001,
  portPostes: 41002,
  machine: 'portable',
  description: 'Cet ordinateur',
  secret: 'secret-factice',
  empreinte: '$argon2-factice',
  claude: null,
  socketTmux: 'lanterne',
  cc: null,
  tmuxConf: null,
  journal: '/d/moteur/journal/moteur.log',
};

describe('environnement du relais et du poste', () => {
  test('le relais écoute en boucle seulement, sans interface ni échos, et ne lit que ses secrets', () => {
    const env = construireEnvironnement(base);
    expect(env['CCREMOTE_HOTES_WEB']).toBe('127.0.0.1');
    expect(env['CCREMOTE_HOTE_POSTES']).toBe('127.0.0.1');
    expect(env['CCREMOTE_PORT_WEB']).toBe('41001');
    expect(env['CCREMOTE_SECRETS_POSTES']).toBe('portable=secret-factice');
    expect(env['QUART_CONFIG_RELAIS']).toBe('/d/moteur/secrets');
    expect(env['CCREMOTE_WEB']).toBe('/d/moteur/sans-interface');
    expect(env['CCREMOTE_ECHO_URL']).toBeUndefined();
  });

  test('le poste reçoit son secret, le socket tmux du moteur, et les fichiers extraits quand ils existent', () => {
    const env = construireEnvironnement({ ...base, claude: '/usr/bin/claude', cc: '/x/cc', tmuxConf: '/x/tmux.conf' });
    expect(env['CCREMOTE_SECRET_POSTE']).toBe('secret-factice');
    expect(env['CCREMOTE_TMUX_SOCKET']).toBe('lanterne');
    expect(env['CCREMOTE_CLAUDE']).toBe('/usr/bin/claude');
    expect(env['CCREMOTE_CC']).toBe('/x/cc');
    expect(env['CCREMOTE_TMUX_CONF']).toBe('/x/tmux.conf');
    expect(env['CCREMOTE_CONFIG_POSTE']).toBe('/d/moteur/poste/poste.json');
  });

  test('poste.json vise le relais embarqué sur la boucle, racine au répertoire personnel', () => {
    expect(contenuPosteJson(base)).toEqual({
      machine: 'portable',
      relais: 'ws://127.0.0.1:41002/poste',
      description: 'Cet ordinateur',
      racines: ['~'],
      donnees: '/d/moteur/poste',
    });
  });
});
