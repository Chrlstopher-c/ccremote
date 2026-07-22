import { describe, expect, test } from 'bun:test';
import { CanalDonnees } from './canal-donnees.ts';
import { ErreurIntegriteTuyau } from './contrat.ts';

const encodeur = new TextEncoder();
const decodeur = new TextDecoder();
const enc = (t: string): Uint8Array => encodeur.encode(t);

interface Trame {
  readonly seq: number;
  readonly payload: Uint8Array;
}

function creerPaire(mode: 'strict' | 'perte_silencieuse' = 'strict') {
  const surLeFil: Trame[] = [];
  const emetteur = new CanalDonnees({
    nom: 'emetteur',
    modeIntegrite: mode,
    envoyer: (seq, payload) => surLeFil.push({ seq, payload }),
  });
  const recepteur = new CanalDonnees({ nom: 'recepteur', modeIntegrite: mode, envoyer: () => {} });
  const recus: Uint8Array[] = [];
  recepteur.surOctets((o) => recus.push(o));
  return { emetteur, recepteur, surLeFil, recus };
}

function livrer(recepteur: CanalDonnees, trames: readonly Trame[]): void {
  for (const t of trames) recepteur.recevoir(t.seq, t.payload);
}

describe('CanalDonnees — ordre et intégrité (D.1.3)', () => {
  test('livraison en ordre, un seul passage', () => {
    const { emetteur, recepteur, surLeFil, recus } = creerPaire();
    emetteur.ecrire(enc('a'));
    emetteur.ecrire(enc('b'));
    livrer(recepteur, surLeFil);
    expect(recus.map((o) => decodeur.decode(o)).join('')).toBe('ab');
  });

  test('critère (a) — 30 s de coupure : rejeu après rattachement, zéro octet perdu ni dupliqué', () => {
    const { emetteur, recepteur, surLeFil, recus } = creerPaire();

    // Tour actif : deux écritures livrées, mais l'ACK n'a pas eu le temps de revenir
    // avant la coupure — le pire cas, celui où le rejeu redevient tentant.
    emetteur.ecrire(enc('a'));
    emetteur.ecrire(enc('b'));
    livrer(recepteur, surLeFil.splice(0));

    // Coupure de 30 s (simulée : aucune horloge réelle) : le tour continue d'écrire.
    emetteur.ecrire(enc('c'));

    // Rétablissement : on rejoue tout ce qui n'est pas acquitté — a, b et c.
    emetteur.rejouerNonAcquitte();
    livrer(recepteur, surLeFil.splice(0));

    expect(recus.map((o) => decodeur.decode(o)).join('')).toBe('abc');
  });

  test('ACK purge le tampon : le rejeu ne renvoie plus que le non-acquitté', () => {
    const { emetteur, surLeFil } = creerPaire();
    emetteur.ecrire(enc('a'));
    emetteur.ecrire(enc('b'));
    expect(emetteur.octetsNonAcquittes()).toBe(2);
    emetteur.acquitterJusque(0); // seul « a » (seq 0) est acquitté
    expect(emetteur.octetsNonAcquittes()).toBe(1);
    surLeFil.length = 0;
    emetteur.rejouerNonAcquitte();
    expect(surLeFil).toHaveLength(1);
    expect(decodeur.decode(surLeFil[0]!.payload)).toBe('b');
  });

  test('doublon (séquence déjà livrée) est ignoré, jamais redélivré', () => {
    const { recepteur, recus } = creerPaire();
    recepteur.recevoir(0, enc('a'));
    recepteur.recevoir(0, enc('a')); // rejeu du même paquet
    expect(recus).toHaveLength(1);
  });

  test('mode strict : un trou de séquence échoue bruyamment (panne #27)', () => {
    const { recepteur } = creerPaire('strict');
    expect(() => recepteur.recevoir(3, enc('x'))).toThrow(ErreurIntegriteTuyau);
  });

  test('mode perte_silencieuse : un trou est absorbé, la suite continue', () => {
    const { recepteur, recus } = creerPaire('perte_silencieuse');
    recepteur.recevoir(3, enc('x'));
    recepteur.recevoir(4, enc('y'));
    expect(recus.map((o) => decodeur.decode(o)).join('')).toBe('xy');
  });

  test('octetsEmis compte tout ce qui a été écrit, même non encore acquitté', () => {
    const { emetteur } = creerPaire();
    emetteur.ecrire(enc('abc'));
    expect(emetteur.octetsEmis()).toBe(3);
  });
});

describe('CanalDonnees — pair neuf après reconnexion (H-75)', () => {
  test('☠ perte_silencieuse : après reset, une trame seq 0 d’un pair neuf est LIVRÉE, pas jetée comme doublon', () => {
    const recus: string[] = [];
    const canal = new CanalDonnees({ nom: 'test', modeIntegrite: 'perte_silencieuse', envoyer: () => {} });
    canal.surOctets((o) => recus.push(new TextDecoder().decode(o)));

    // Premier pair : seq 0 puis 1 livrés, seqAttendu monte à 2.
    canal.recevoir(0, new TextEncoder().encode('a'));
    canal.recevoir(1, new TextEncoder().encode('b'));
    expect(recus).toEqual(['a', 'b']);

    // Sans reset, la trame seq 0 du pair NEUF serait jetée (0 < 2). C'est
    // exactement le bug de production : chaque requête de contrôle expirait.
    canal.reinitialiserReceptionSiPairNeuf();
    canal.recevoir(0, new TextEncoder().encode('c'));
    expect(recus).toEqual(['a', 'b', 'c']);
  });

  test('☠ strict : le reset est INERTE — le rejeu impose de préserver les séquences (zéro octet dupliqué)', () => {
    const recus: string[] = [];
    const canal = new CanalDonnees({ nom: 'test', modeIntegrite: 'strict', envoyer: () => {} });
    canal.surOctets((o) => recus.push(new TextDecoder().decode(o)));

    canal.recevoir(0, new TextEncoder().encode('a'));
    canal.reinitialiserReceptionSiPairNeuf(); // ne doit RIEN faire en strict
    // seq 0 rejoué doit rester un doublon ignoré, pas une redélivrance.
    canal.recevoir(0, new TextEncoder().encode('a-dup'));
    expect(recus).toEqual(['a']);
  });
});
