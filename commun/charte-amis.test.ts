// Responsabilité : tests des droits des amis du duo dans la charte — fermé par défaut, droits par machine vérifiés par
// la machine visée, édition réservée aux chefs, retrait d'une machine, charte relisible et refusée si incohérente.
import { describe, expect, test } from 'bun:test';
import { exporterIdentitePublique, genererIdentite } from './chiffrement/identite.ts';
import { autoriseAmi, droitsAmiSur, regleDroitsAmi } from './charte-amis.ts';
import {
  AUCUN_DROIT,
  type Charte,
  type Droits,
  lireCharte,
  type MembreCharte,
  type RequeteDroit,
  retirerMembre,
  TOUS_DROITS,
} from './charte.ts';

const RESEAU = '111111111111';
const LE = '2026-11-22T10:00:00.000Z';
const CHEF = 'aaaaaaaaaaaa';
const SERVEUR = 'bbbbbbbbbbbb';
const M2 = 'cccccccccccc';
const TEL = 'dddddddddddd';
const AMI = 'eeeeeeeeeeee';
const PILOTER: Droits = { voir: true, piloter: true, lancer: false, remoteControl: false };
const ECRIRE: RequeteDroit = { genre: 'ecrire' };

async function identite(): Promise<string> {
  return exporterIdentitePublique((await genererIdentite()).publique);
}

function membre(id: string, identiteTexte: string, sorte: MembreCharte['sorte']): MembreCharte {
  return { id, nom: `nom-${id}`, sorte, identite: identiteTexte, droits: TOUS_DROITS, compte: null };
}

async function charteAvecAmi(): Promise<Charte> {
  return {
    format: 1,
    reseau: RESEAU,
    nom: 'Parc',
    version: 3,
    chefs: [CHEF],
    membres: [
      membre(CHEF, await identite(), 'pair'),
      membre(SERVEUR, await identite(), 'serveur'),
      membre(M2, await identite(), 'pair'),
      membre(TEL, await identite(), 'telephone'),
    ],
    le: LE,
    par: CHEF,
    origine: 'creation',
    amis: [{ ami: AMI, machines: { [SERVEUR]: PILOTER } }],
  };
}

describe('droits d un ami du duo par machine', () => {
  test('fermé sans charte, sans ami, ou pour une machine non listée', async () => {
    const c = await charteAvecAmi();
    expect(droitsAmiSur(null, AMI, SERVEUR)).toEqual(AUCUN_DROIT);
    expect(droitsAmiSur({ ...c, amis: undefined }, AMI, SERVEUR)).toEqual(AUCUN_DROIT);
    expect(droitsAmiSur(c, 'ffffffffffff', SERVEUR)).toEqual(AUCUN_DROIT);
    expect(droitsAmiSur(c, AMI, M2)).toEqual(AUCUN_DROIT);
  });

  test('la machine visée accorde selon sa ligne seulement', async () => {
    const c = await charteAvecAmi();
    expect(autoriseAmi(c, AMI, SERVEUR, ECRIRE)).toBe(true);
    expect(autoriseAmi(c, AMI, M2, ECRIRE)).toBe(false);
    expect(autoriseAmi(c, AMI, SERVEUR, { genre: 'ouvrir' })).toBe(false);
    const lecture = { genre: 'api', methode: 'GET', chemin: '/api/sessions/s1/remote-control' } as const;
    expect(autoriseAmi(c, AMI, SERVEUR, lecture)).toBe(false);
  });

  test('un chef règle les droits par machine ; la version avance, les autres machines restent', async () => {
    const c = await charteAvecAmi();
    const e = regleDroitsAmi(c, CHEF, AMI, M2, TOUS_DROITS, LE);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.charte.version).toBe(4);
    expect(autoriseAmi(e.charte, AMI, M2, { genre: 'ouvrir' })).toBe(true);
    expect(autoriseAmi(e.charte, AMI, SERVEUR, ECRIRE)).toBe(true);
  });

  test('édition refusée : auteur non chef, machine inconnue, invitée ou téléphone, ami invalide', async () => {
    const c = await charteAvecAmi();
    expect(regleDroitsAmi(c, M2, AMI, SERVEUR, PILOTER, LE).ok).toBe(false);
    expect(regleDroitsAmi(c, CHEF, AMI, 'ffffffffffff', PILOTER, LE).ok).toBe(false);
    expect(regleDroitsAmi(c, CHEF, AMI, TEL, PILOTER, LE).ok).toBe(false);
    expect(regleDroitsAmi(c, CHEF, 'PAS-UN-ID', SERVEUR, PILOTER, LE).ok).toBe(false);
  });

  test('retirer une machine retire ses droits d ami ; la charte reste relisible', async () => {
    const c = await charteAvecAmi();
    const e = retirerMembre(c, CHEF, SERVEUR, LE);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.charte.amis).toEqual([{ ami: AMI, machines: {} }]);
    expect(lireCharte(JSON.stringify(e.charte))).not.toBeNull();
  });

  test('charte relue : droits d ami acceptés ; machine absente du parc ou téléphone refusés', async () => {
    const c = await charteAvecAmi();
    expect(lireCharte(JSON.stringify(c))).not.toBeNull();
    const sansAmi = { ...c, amis: undefined };
    expect(lireCharte(JSON.stringify(sansAmi))).not.toBeNull();
    const fantome = { ...c, amis: [{ ami: AMI, machines: { ffffffffffff: PILOTER } }] };
    expect(lireCharte(JSON.stringify(fantome))).toBeNull();
    const telephone = { ...c, amis: [{ ami: AMI, machines: { [TEL]: PILOTER } }] };
    expect(lireCharte(JSON.stringify(telephone))).toBeNull();
  });
});
