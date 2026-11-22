// État d'une machine de nœud : mesure (CPU, mémoire, GPU présent ou absent, réseau, fonctions), envoi aux pairs reliés,
// réception (dernier état gardé, MAC apprise pour le réveil). Commandes factices : rien de réel n'est lancé.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { MessageChiffre } from '../../commun/federation.ts';
import type { EtatNoeud } from '../../commun/federation.ts';
import { ReseauxConnus } from '../entretien/reseaux.ts';
import { attendre } from './banc-federation.ts';
import { analyserGpu, type DependancesEtatNoeud, mesurerEtatNoeud } from './etat-noeud.ts';
import { EtatsNoeud } from './etat-noeud-echange.ts';

const journal = pino({ enabled: false });
const MAC = '02:00:00:00:00:0b';
const DIFFUSION = '192.0.2.255';
const MEMBRE_PAIR = 'a1b2c3d4e5f6';
const GPU_FACTICE = ['sh', '-c', "printf 'RTX Factice, 42, 1024, 8192\\n'"];
const NVIDIA_ABSENT = ['/chemin/inexistant/nvidia-smi-factice'];
const BASE: DependancesEtatNoeud = {
  journal,
  pause: () => false,
  comptes: () => ['perso'],
  reseau: () => ({ mac: MAC, diffusion: DIFFUSION }),
  nvidiaSmi: NVIDIA_ABSENT,
};
const ETAT_FACTICE: EtatNoeud = {
  le: '2026-11-22T10:00:00.000Z',
  cpu: 3.5,
  charge: 0.4,
  memoire: { utilisee: 1, totale: 2 },
  gpu: null,
  reseau: { mac: MAC, diffusion: DIFFUSION },
  pause: false,
  fonctions: { voix: 'absente', dictee: 'absente' },
  comptes: [],
  compte: null,
  peutArreter: true,
  peutRedemarrer: false,
  reveilPossible: true,
};

let dossier: string;
let reseaux: ReseauxConnus;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'etat-noeud-'));
  reseaux = new ReseauxConnus(join(dossier, 'reveil.json'), journal);
});

afterEach(() => {
  delete process.env['LANTERNE_MOTEUR_AUTONOME'];
});

type Envoi = { envoyes: MessageChiffre[]; canal: { membre: string; envoyer(m: MessageChiffre): boolean } };

function canalFactice(membre: string): Envoi {
  const envoyes: MessageChiffre[] = [];
  return { envoyes, canal: { membre, envoyer: (m) => (envoyes.push(m), true) } };
}

describe('mesure de l’état', () => {
  test('GPU présent : nom, utilisation et mémoire lus ; réseau, comptes et compte choisi remontés', async () => {
    const etat = await mesurerEtatNoeud({ ...BASE, nvidiaSmi: GPU_FACTICE, compteChoisi: () => 'perso' });
    expect(etat.gpu).toEqual([{ nom: 'RTX Factice', utilisation: 42, memoireUtilisee: 1024, memoireTotale: 8192 }]);
    expect(etat.reseau).toEqual({ mac: MAC, diffusion: DIFFUSION });
    expect(etat.reveilPossible).toBe(true);
    expect(etat.comptes).toEqual(['perso']);
    expect(etat.compte).toBe('perso');
    expect(etat.pause).toBe(false);
    expect(etat.fonctions).toEqual({ voix: 'absente', dictee: 'absente' });
  });

  test('GPU absent : null ; sans MAC, le réveil n’est pas possible', async () => {
    const etat = await mesurerEtatNoeud({ ...BASE, reseau: () => null });
    expect(etat.gpu).toBeNull();
    expect(etat.reseau).toBeNull();
    expect(etat.reveilPossible).toBe(false);
  });

  test('nvidia-smi en échec (code non nul) : null, la mesure continue', async () => {
    const etat = await mesurerEtatNoeud({ ...BASE, nvidiaSmi: ['sh', '-c', 'exit 3'] });
    expect(etat.gpu).toBeNull();
    expect(etat.memoire).not.toBeNull();
  });

  test('CPU et mémoire dans leurs bornes ; voix et dictée lues ; sonde en erreur : « absente »', async () => {
    const etat = await mesurerEtatNoeud({
      ...BASE,
      fonctions: { voix: () => 'lancee', dictee: () => 'arretee' },
    });
    expect(etat.cpu === null || (etat.cpu >= 0 && etat.cpu <= 100)).toBe(true);
    expect(etat.memoire !== null && etat.memoire.utilisee <= etat.memoire.totale).toBe(true);
    expect(etat.fonctions).toEqual({ voix: 'lancee', dictee: 'arretee' });
    const casse = await mesurerEtatNoeud({
      ...BASE,
      fonctions: {
        voix: () => {
          throw new Error('sonde cassée');
        },
      },
    });
    expect(casse.fonctions.voix).toBe('absente');
  });

  test('peutRedemarrer suit LANTERNE_MOTEUR_AUTONOME ; peutArreter vaut sous Linux et macOS', async () => {
    expect((await mesurerEtatNoeud(BASE)).peutRedemarrer).toBe(false);
    process.env['LANTERNE_MOTEUR_AUTONOME'] = '1';
    expect((await mesurerEtatNoeud(BASE)).peutRedemarrer).toBe(true);
    expect((await mesurerEtatNoeud(BASE)).peutArreter).toBe(process.platform !== 'win32');
  });

  test('analyse de nvidia-smi : plusieurs GPU ; valeurs « [N/A] » ramenées à null', () => {
    expect(analyserGpu('A, 5, 10, 20\nB, [N/A], [N/A], 8\n')).toEqual([
      { nom: 'A', utilisation: 5, memoireUtilisee: 10, memoireTotale: 20 },
      { nom: 'B', utilisation: null, memoireUtilisee: null, memoireTotale: 8 },
    ]);
    expect(analyserGpu('')).toEqual([]);
  });
});

describe('échange entre nœuds', () => {
  test('envoi à un pair : un message etat_noeud portant la mesure', async () => {
    const etats = new EtatsNoeud({ mesurer: async () => ETAT_FACTICE, reseaux, machineDe: () => 'tour', journal });
    const pair = canalFactice(MEMBRE_PAIR);
    await etats.envoyerA(pair.canal);
    expect(pair.envoyes).toEqual([{ t: 'etat_noeud', etat: ETAT_FACTICE }]);
  });

  test('réception : dernier état gardé, MAC du pair apprise sous son identifiant de machine', async () => {
    const etats = new EtatsNoeud({ mesurer: async () => ETAT_FACTICE, reseaux, machineDe: () => 'tour', journal });
    expect(etats.de(MEMBRE_PAIR)).toBeNull();
    etats.recevoir(MEMBRE_PAIR, ETAT_FACTICE);
    expect(etats.de(MEMBRE_PAIR)).toEqual(ETAT_FACTICE);
    expect(reseaux.de('tour')).toEqual({ mac: MAC, diffusion: DIFFUSION });
  });

  test('réception sans MAC, ou pair dont la machine est inconnue : rien n’est appris', async () => {
    const sansMac = new EtatsNoeud({ mesurer: async () => ETAT_FACTICE, reseaux, machineDe: () => 'tour', journal });
    sansMac.recevoir(MEMBRE_PAIR, { ...ETAT_FACTICE, reseau: null });
    expect(reseaux.de('tour')).toBeNull();
    const inconnu = new EtatsNoeud({ mesurer: async () => ETAT_FACTICE, reseaux, machineDe: () => null, journal });
    inconnu.recevoir(MEMBRE_PAIR, ETAT_FACTICE);
    expect(reseaux.ids()).toEqual([]);
  });

  test('minuterie : envoi à chaque tour, arrêtée par arreter()', async () => {
    const etats = new EtatsNoeud({
      mesurer: async () => ETAT_FACTICE,
      reseaux,
      machineDe: () => null,
      journal,
      intervalleMs: 10,
    });
    const pair = canalFactice(MEMBRE_PAIR);
    etats.demarrer(() => [pair.canal]);
    await attendre(() => pair.envoyes.length >= 2, 1000);
    etats.arreter();
    await new Promise((r) => setTimeout(r, 30));
    const nombre = pair.envoyes.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(pair.envoyes.length).toBe(nombre);
  });
});
