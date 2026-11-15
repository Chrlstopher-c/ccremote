// Responsabilité : tests du terminal à distance côté monde — faux WebSocket, aucun réseau réel.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  ouvrirTerminalRelais,
  urlTerminal,
  type BilanTerminal,
  type OptionsOuverture,
  type SessionTerminal,
} from './terminal';
import { PROTOCOLE_FLUX } from './transport-flux';

class FauxSocket {
  binaryType = 'blob';
  readonly envoyes: (string | Uint8Array)[] = [];
  codeFermeture: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocoles: string[],
  ) {}

  send(donnees: string | Uint8Array): void {
    this.envoyes.push(donnees);
  }

  close(code?: number): void {
    this.codeFermeture = code ?? 1000;
  }
}

function fabriqueFausse(): { fabrique: (url: string, protocoles: string[]) => WebSocket; sockets: FauxSocket[] } {
  const sockets: FauxSocket[] = [];
  const fabrique = (url: string, protocoles: string[]): WebSocket => {
    const socket = new FauxSocket(url, protocoles);
    sockets.push(socket);
    return socket as unknown as WebSocket; // faux WebSocket : seules les propriétés utilisées par le terminal existent
  };
  return { fabrique, sockets };
}

const OUVERTURE: OptionsOuverture = {
  machine: 'poste-a',
  cible: { type: 'shell', dossier: '/srv/projet' },
  colonnes: 80,
  lignes: 24,
};

function ouvrir(options: OptionsOuverture = OUVERTURE): { term: SessionTerminal; socket: FauxSocket } {
  const { fabrique, sockets } = fabriqueFausse();
  const term = ouvrirTerminalRelais({ base: 'https://relais.example.com', jeton: 'jeton-test', fabrique })(options);
  const socket = sockets[0];
  if (!socket) throw new Error('aucun socket créé');
  return { term, socket };
}

function message(socket: FauxSocket, donnees: unknown): void {
  socket.onmessage?.({ data: donnees });
}

describe('urlTerminal', () => {
  test('pointe sur /api/terminal en ws, avec le dossier et les dimensions, sans jeton', () => {
    const url = urlTerminal('https://relais.example.com/', OUVERTURE);
    const attendu = 'wss://relais.example.com/api/terminal?machine=poste-a&colonnes=80&lignes=24';
    expect(url).toBe(`${attendu}&dossier=%2Fsrv%2Fprojet`);
    expect(url).not.toContain('jeton');
  });

  test('une cible tmux passe son nom de session', () => {
    const url = urlTerminal('http://127.0.0.1:8080', { ...OUVERTURE, cible: { type: 'tmux', tmux: 'claude-1' } });
    expect(url).toBe('ws://127.0.0.1:8080/api/terminal?machine=poste-a&colonnes=80&lignes=24&tmux=claude-1');
  });
});

describe('ouverture et saisie', () => {
  test('authentifie par sous-protocole, jamais par l URL', () => {
    const { socket } = ouvrir();
    expect(socket.protocoles).toEqual([PROTOCOLE_FLUX, 'jeton-test']);
    expect(socket.binaryType).toBe('arraybuffer');
  });

  test('la saisie tapée avant l ouverture part dès que la connexion est prête, en octets UTF-8', () => {
    const { term, socket } = ouvrir();
    term.ecrire('ls é\r');
    expect(socket.envoyes).toEqual([]);
    socket.onopen?.();
    expect(socket.envoyes).toEqual([new TextEncoder().encode('ls é\r')]);
  });

  test('une saisie après ouverture part tout de suite', () => {
    const { term, socket } = ouvrir();
    socket.onopen?.();
    term.ecrire('pwd\r');
    expect(socket.envoyes).toEqual([new TextEncoder().encode('pwd\r')]);
  });

  test('un redimensionnement envoie le message JSON attendu par le relais', () => {
    const { term, socket } = ouvrir();
    socket.onopen?.();
    term.redimensionner(100, 40);
    expect(socket.envoyes).toEqual(['{"type":"taille","colonnes":100,"lignes":40}']);
  });
});

describe('sortie', () => {
  test('les octets reçus sont décodés en texte, un caractère coupé entre deux morceaux reste juste', () => {
    const { term, socket } = ouvrir();
    const recu: string[] = [];
    term.surSortie((t) => recu.push(t));
    const octets = new TextEncoder().encode('é!');
    message(socket, octets.slice(0, 1).buffer);
    message(socket, octets.slice(1).buffer);
    expect(recu.join('')).toBe('é!');
  });

  test('une sortie arrivée avant l abonnement n est pas perdue', () => {
    const { term, socket } = ouvrir();
    message(socket, new TextEncoder().encode('bienvenue\r\n').buffer);
    const recu: string[] = [];
    term.surSortie((t) => recu.push(t));
    expect(recu).toEqual(['bienvenue\r\n']);
  });
});

describe('fin de terminal', () => {
  test('un message fin du poste remonte son code de sortie', () => {
    const { term, socket } = ouvrir();
    const bilans: BilanTerminal[] = [];
    term.surFin((b) => bilans.push(b));
    message(socket, JSON.stringify({ type: 'fin', code: 0 }));
    expect(bilans).toEqual([{ code: 0, erreur: null }]);
  });

  test('un message erreur du relais remonte son motif', () => {
    const { term, socket } = ouvrir();
    const bilans: BilanTerminal[] = [];
    term.surFin((b) => bilans.push(b));
    message(socket, JSON.stringify({ type: 'erreur', message: 'poste-a s’est déconnecté' }));
    expect(bilans).toEqual([{ code: null, erreur: 'poste-a s’est déconnecté' }]);
  });

  test('une coupure sans fin annoncée est signalée comme interruption', () => {
    const { term, socket } = ouvrir();
    const bilans: BilanTerminal[] = [];
    term.surFin((b) => bilans.push(b));
    socket.onclose?.();
    expect(bilans).toEqual([{ code: null, erreur: 'connexion interrompue' }]);
  });

  test('fermer ferme la connexion sans signaler de fin', () => {
    const { term, socket } = ouvrir();
    const bilans: BilanTerminal[] = [];
    term.surFin((b) => bilans.push(b));
    term.fermer();
    socket.onclose?.();
    expect(socket.codeFermeture).toBe(1000);
    expect(bilans).toEqual([]);
  });
});
