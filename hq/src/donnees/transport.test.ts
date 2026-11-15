// Responsabilité : tests du transport du relais avec un faux fetch et un faux WebSocket (aucun réseau réel).
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { EcouteurSource, EtatLien } from './source-monde';
import type { MessageClient } from './contrat';
import { ClientRelais, ErreurRelais, type Recuperer } from './transport-http';
import { BACKOFF_MAX_MS, FluxRelais, PROTOCOLE_FLUX } from './transport-flux';
import { creerSourceRelais } from './transport';

interface Appel {
  readonly url: string;
  readonly methode: string;
  readonly entetes: Record<string, string>;
  readonly corps: string | null;
}

function fauxFetch(statut: number, corps: unknown): { recuperer: Recuperer; appels: Appel[] } {
  const appels: Appel[] = [];
  const recuperer: Recuperer = async (url, init) => {
    appels.push({
      url,
      methode: init.method ?? 'GET',
      entetes: { ...(init.headers as Record<string, string>) },
      corps: typeof init.body === 'string' ? init.body : null,
    });
    return new Response(JSON.stringify(corps), { status: statut });
  };
  return { recuperer, appels };
}

describe('ClientRelais', () => {
  test('lit l état avec le jeton porteur, sur l URL de base', async () => {
    const { recuperer, appels } = fauxFetch(200, { version: 1, machines: [] });
    const client = new ClientRelais('https://relais.example.com', 'jeton-test', recuperer);
    await client.etat();
    expect(appels[0]?.url).toBe('https://relais.example.com/api/etat');
    expect(appels[0]?.methode).toBe('GET');
    expect(appels[0]?.entetes['authorization']).toBe('Bearer jeton-test');
  });

  test('envoie un message en POST JSON et encode l identifiant de session', async () => {
    const { recuperer, appels } = fauxFetch(200, {});
    const client = new ClientRelais('https://relais.example.com', 'j', recuperer);
    await client.envoyerMessage('a/b', 'bonjour');
    expect(appels[0]?.url).toBe('https://relais.example.com/api/sessions/a%2Fb/messages');
    expect(appels[0]?.corps).toBe('{"texte":"bonjour"}');
  });

  test('une action de session passe par sa route, archiver compris', async () => {
    const { recuperer, appels } = fauxFetch(200, {});
    const client = new ClientRelais('https://relais.example.com', 'j', recuperer);
    await client.agir('s1', 'archiver');
    expect(appels[0]?.url).toBe('https://relais.example.com/api/sessions/s1/archiver');
    expect(appels[0]?.methode).toBe('POST');
  });

  test('une réponse en erreur lève une ErreurRelais avec le statut et le message du relais', async () => {
    const { recuperer } = fauxFetch(409, { erreur: 'machine hors ligne' });
    const client = new ClientRelais('https://relais.example.com', 'j', recuperer);
    const erreur = await client.agir('s1', 'fermer').catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ErreurRelais);
    expect((erreur as ErreurRelais).statut).toBe(409);
    expect((erreur as ErreurRelais).message).toBe('machine hors ligne');
  });

  test('un relais injoignable lève une ErreurRelais de statut 0', async () => {
    const recuperer: Recuperer = async () => {
      throw new TypeError('fetch failed');
    };
    const client = new ClientRelais('https://relais.example.com', 'j', recuperer);
    const erreur = await client.etat().catch((e: unknown) => e);
    expect((erreur as ErreurRelais).statut).toBe(0);
  });
});

class FauxSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocoles: string[],
  ) {}
  close(): void {
    this.onclose?.();
  }
  ouvrir(): void {
    this.onopen?.();
  }
  recevoir(data: string): void {
    this.onmessage?.({ data });
  }
  perdre(): void {
    this.onclose?.();
  }
}

interface Banc {
  readonly sockets: FauxSocket[];
  readonly delais: number[];
  readonly lancerProchain: () => void;
  readonly flux: FluxRelais;
  readonly liens: EtatLien[];
  readonly messages: MessageClient[];
}

function banc(jeton = 'jeton-test'): Banc {
  const sockets: FauxSocket[] = [];
  const delais: number[] = [];
  const fonctions: Array<() => void> = [];
  const liens: EtatLien[] = [];
  const messages: MessageClient[] = [];
  const fabrique = (url: string, protocoles: string[]): WebSocket => {
    const s = new FauxSocket(url, protocoles);
    sockets.push(s);
    return s as unknown as WebSocket; // faux WebSocket : seules les propriétés utilisées par FluxRelais existent
  };
  const programmer = (fn: () => void, ms: number): void => {
    delais.push(ms);
    fonctions.push(fn);
  };
  const flux = new FluxRelais('wss://relais.example.com/api/flux', jeton, fabrique, programmer);
  return { sockets, delais, lancerProchain: () => fonctions.shift()?.(), flux, liens, messages };
}

function demarrer(b: Banc): void {
  const ecouteur: EcouteurSource = {
    surLien: (l) => b.liens.push(l),
    surMessage: (m) => b.messages.push(m),
  };
  b.flux.demarrer(ecouteur);
}

describe('FluxRelais', () => {
  test('se connecte avec le protocole et le jeton en sous-protocole, jamais dans l URL', () => {
    const b = banc('secret');
    demarrer(b);
    expect(b.sockets[0]?.url).toBe('wss://relais.example.com/api/flux');
    expect(b.sockets[0]?.protocoles).toEqual([PROTOCOLE_FLUX, 'secret']);
  });

  test('signale la connexion puis l ouverture, et transmet les messages valides', () => {
    const b = banc();
    demarrer(b);
    b.sockets[0]?.ouvrir();
    b.sockets[0]?.recevoir('{"type":"echo","echo":{}}');
    expect(b.liens).toEqual(['connexion', 'ouvert']);
    expect(b.messages).toEqual([{ type: 'echo', echo: {} }]);
  });

  test('un message illisible est ignoré sans couper le flux', () => {
    const b = banc();
    demarrer(b);
    b.sockets[0]?.ouvrir();
    b.sockets[0]?.recevoir('pas du json');
    expect(b.messages).toEqual([]);
    expect(b.liens).toEqual(['connexion', 'ouvert']);
  });

  test('après une coupure, reconnexion avec backoff doublé et plafonné', () => {
    const b = banc();
    demarrer(b);
    const delais: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      b.sockets[b.sockets.length - 1]?.perdre();
      delais.push(b.delais[b.delais.length - 1] ?? -1);
      b.lancerProchain();
    }
    expect(delais).toEqual([1000, 2000, 4000, 8000, 16000, BACKOFF_MAX_MS]);
    expect(b.sockets.length).toBe(7);
  });

  test('une ouverture réussie remet le backoff à sa valeur minimale', () => {
    const b = banc();
    demarrer(b);
    b.sockets[0]?.perdre();
    b.lancerProchain();
    b.sockets[1]?.ouvrir();
    b.sockets[1]?.perdre();
    expect(b.delais).toEqual([1000, 1000]);
  });

  test('arreter coupe sans reconnecter', () => {
    const b = banc();
    demarrer(b);
    b.flux.arreter();
    expect(b.liens[b.liens.length - 1]).toBe('coupe');
    b.lancerProchain();
    expect(b.sockets.length).toBe(1);
  });
});

describe('creerSourceRelais', () => {
  test('assemble une source « relais » dont l URL de flux suit le schéma de la base', async () => {
    const { recuperer, appels } = fauxFetch(200, { version: 3, machines: [], sessions: [] });
    const source = creerSourceRelais({
      base: 'https://relais.example.com/',
      jeton: 'j',
      recuperer,
      fabrique: (url, protocoles) => new FauxSocket(url, protocoles) as unknown as WebSocket,
      programmer: () => undefined,
    });
    expect(source.nom).toBe('relais');
    expect((await source.etatInitial()).version).toBe(3);
    expect(appels[0]?.url).toBe('https://relais.example.com/api/etat');
  });
});
