// Responsabilité : tests des droits par machine d'un ami — schéma et `droitsSurMachine`, filtre « voir » de la synchro,
// refus « lancer » et « piloter », dossiers offerts filtrés. Montages : synchro seule, banc à deux relais.
/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test';
import pino from 'pino';
import {
  DROITS_NOUVEL_AMI,
  DROITS_PAR_DEFAUT,
  Droits,
  type DroitsMachineAmi,
  droitsSurMachine,
  type MessageLien,
} from '../../commun/duo.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { attendre, type Banc, deuxBancs, ficheOuverte, poster } from './banc-duo.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { PartagesDuo } from './partages.ts';
import { Synchro } from './synchro.ts';

const journal = pino({ enabled: false });
const MAJ = '2026-11-21T10:00:00.000Z';
const TOUT: DroitsMachineAmi = { voir: true, piloter: true, lancer: true };
const RIEN: DroitsMachineAmi = { voir: false, piloter: false, lancer: false };

const bancs: Banc[] = [];
afterEach(() => {
  for (const b of bancs.splice(0)) b.duo.arreter();
});

async function duo(): Promise<{ a: Banc; b: Banc }> {
  const { a, b } = await deuxBancs();
  bancs.push(a, b);
  return { a, b };
}

function droits(surcharge: Partial<Droits>): Droits {
  return { ...DROITS_PAR_DEFAUT, ...surcharge };
}

function sessionSur(id: string, machine: string): ResumeSession {
  const fiche = ficheOuverte(id, '/p1', 'default');
  return { ...fiche, machine, projet: { machine, chemin: '/p1', nom: 'p' } };
}

function idsPartagees(m: MessageLien): string[] {
  return m.type === 'partage' ? m.sessions.map((s) => s.fiche.id) : [];
}

// Synchro seule : une session sur « tour » et une sur « portable », toutes deux partagées en lecture.
function synchroSeule(d: Droits): Synchro {
  const base = ouvrirBase(':memory:');
  const registre = new Registre(base, journal);
  const partages = new PartagesDuo(base);
  partages.ajouter('s1', 'session', 'lecture', MAJ);
  partages.ajouter('s2', 'session', 'lecture', MAJ);
  registre.enregistrerSession(sessionSur('s1', 'tour'));
  registre.enregistrerSession(sessionSur('s2', 'portable'));
  return new Synchro(registre, new Diffusion(), partages, journal, () => null, () => d);
}

function partagerEcriture(a: Banc, id: string): void {
  poster(a, { kind: 'session', session: ficheOuverte(id, '/p1', 'default') });
  a.duo.partager({ cible: id, genre: 'session', niveau: 'ecriture' });
}

const commandesEnvoi = (a: Banc): Record<string, unknown>[] => a.commandes.filter((c) => c['kind'] === 'envoyer');
const ouvertures = (a: Banc): Record<string, unknown>[] => a.commandes.filter((c) => c['kind'] === 'ouvrir');

describe('droits par machine : lecture et schéma', () => {
  test('droitsSurMachine : sans liste (absente ou null), toutes les machines sont permises', () => {
    expect(droitsSurMachine(DROITS_PAR_DEFAUT, 'tour')).toEqual(TOUT);
    expect(droitsSurMachine(droits({ machines: null }), 'tour')).toEqual(TOUT);
  });

  test('droitsSurMachine : liste vide ou machine non listée, rien ; machine listée, ses droits', () => {
    expect(droitsSurMachine(DROITS_NOUVEL_AMI, 'tour')).toEqual(RIEN);
    const d = droits({ machines: { tour: { voir: true, piloter: false, lancer: false } } });
    expect(droitsSurMachine(d, 'tour')).toEqual({ voir: true, piloter: false, lancer: false });
    expect(droitsSurMachine(d, 'portable')).toEqual(RIEN);
  });

  test('schéma : un réglage ancien (sans machines) reste valide ; une machine mal formée est refusée', () => {
    expect(Droits.safeParse(DROITS_PAR_DEFAUT).success).toBe(true);
    expect(Droits.safeParse({ ...DROITS_NOUVEL_AMI }).success).toBe(true);
    expect(Droits.safeParse({ ...DROITS_PAR_DEFAUT, machines: { tour: { voir: 'oui' } } }).success).toBe(false);
  });
});

describe('droits par machine : voir (synchro)', () => {
  const sansTour = droits({ machines: { portable: TOUT } });

  test('instantané : seules les sessions des machines avec « voir » partent', () => {
    expect(idsPartagees(synchroSeule(sansTour).instantane())).toEqual(['s2']);
    expect(idsPartagees(synchroSeule(DROITS_PAR_DEFAUT).instantane())).toEqual(['s1', 's2']);
  });

  test('fiche et relecture : une session d’une machine sans « voir » n’est pas envoyée', () => {
    const s = synchroSeule(sansTour);
    expect(s.versLien({ type: 'session', session: sessionSur('s1', 'tour') })).toBeNull();
    expect(s.versLien({ type: 'session', session: sessionSur('s2', 'portable') })).toMatchObject({ type: 'fiche' });
    expect(s.relecture('s1')).toBeNull();
    expect(s.relecture('s2')).toMatchObject({ type: 'historique', sessionId: 's2' });
  });
});

describe('droits par machine : piloter et lancer', () => {
  test('écrire dans une session d’une machine sans « piloter » : refusé, journalisé', async () => {
    const { a, b } = await duo();
    a.duo.majDroits(droits({ machines: { tour: { voir: true, piloter: false, lancer: true } } }));
    partagerEcriture(a, 's2');
    await attendre(() => b.registre.session('s2') !== null);
    const r = await b.duo.ecrireAPair('s2', 'bonjour', []);
    expect(r).toMatchObject({ ok: false, raison: 'machine non permise' });
    expect(commandesEnvoi(a)).toEqual([]);
    expect(a.duo.journalDuo()[0]).toMatchObject({ qui: 'bob', action: 'ecrire', cible: 's2' });
  });

  test('écrire avec « piloter » sur la machine : envoyé', async () => {
    const { a, b } = await duo();
    a.duo.majDroits(droits({ machines: { tour: TOUT } }));
    partagerEcriture(a, 's2');
    await attendre(() => b.registre.session('s2') !== null);
    expect(await b.duo.ecrireAPair('s2', 'bonjour', [])).toEqual({ ok: true, valeur: null });
    expect(commandesEnvoi(a)).toHaveLength(1);
  });

  test('ouvrir une session sur une machine sans « lancer » : refusé avant toute demande', async () => {
    const { a, b } = await duo();
    a.duo.majDroits(droits({ machines: {} }));
    const r = await b.duo.ouvrirChezPair({ machine: 'tour', chemin: '/p1', message: 'salut' });
    expect(r).toMatchObject({ ok: false, raison: 'refusé par alice' });
    expect(a.duo.listerDemandes()).toEqual([]);
    expect(ouvertures(a)).toEqual([]);
  });

  test('dossiers offerts : seulement ceux des machines avec « lancer »', async () => {
    const { a, b } = await duo();
    a.duo.majDroits(
      droits({
        dossiersOuverts: [
          { machine: 'tour', chemin: '/p1' },
          { machine: 'portable', chemin: '/p2' },
        ],
        machines: { tour: TOUT, portable: { voir: true, piloter: true, lancer: false } },
      }),
    );
    expect(await b.duo.dossiersDuPair()).toEqual({
      ok: true,
      valeur: [{ machine: 'tour', chemin: '/p1', nomMachine: 'tour' }],
    });
  });
});
