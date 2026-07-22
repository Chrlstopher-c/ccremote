// Injecteurs des pannes #24 (retour `null` sans envoi hors-bande confirmé —
// agent bloqué à vie) et #25 (redélivrance non dédupliquée — notification en
// double à chaque reconnexion), plus le balayage de l'invariant I-5.

import { describe, expect, test } from 'bun:test';
import { HorlogeSimulee } from '../deterministe/horloge-simulee.ts';
import { JournalPannes } from '../journal/journal-pannes.ts';
import type { EntreeDemande, Verdict } from '../contrats/permissions.ts';
import { BusPermissionsFactice, OPTIONS_BUS_SAINES } from './bus-permissions-factice.ts';
import { rejouerDeuxFois } from '../rejeu.ts';

const DEMANDE: EntreeDemande = {
  requestId: 'req-1',
  idWorker: 'w1',
  outil: 'Bash',
  decisionReason: 'commande hors plancher',
};

const ALLOW: Verdict = { behavior: 'allow' };

interface Montage {
  readonly horloge: HorlogeSimulee;
  readonly journal: JournalPannes;
  readonly bus: BusPermissionsFactice;
}

const monter = (deduplication = true): Montage => {
  const horloge = new HorlogeSimulee();
  const journal = new JournalPannes(horloge);
  const bus = new BusPermissionsFactice(horloge, journal, { ...OPTIONS_BUS_SAINES, deduplication });
  return { horloge, journal, bus };
};

describe('BusPermissionsFactice — cycle de vie C.2.1', () => {
  test('une demande reçue notifie une fois et attend', () => {
    const { bus, journal } = monter();
    bus.recevoir(DEMANDE);
    expect(bus.notificationsEmises()).toBe(1);
    expect(bus.demande('req-1')?.etat).toBe('en_attente');
    expect(bus.enAttente()).toHaveLength(1);
    expect(journal.contient('permission_recue')).toBe(true);
  });

  test('répondre puis confirmer traverse repondue → confirmee', () => {
    const { horloge, bus } = monter();
    bus.recevoir(DEMANDE);
    horloge.avancer(1_000);
    bus.repondre('req-1', ALLOW);
    expect(bus.demande('req-1')?.repondueA).toBe(1_000);
    horloge.avancer(500);
    bus.confirmer('req-1');
    const demande = bus.demande('req-1');
    expect(demande?.etat).toBe('confirmee');
    expect(demande?.confirmeeA).toBe(1_500);
  });

  test('un tour avorté rend la demande caduque, une demande confirmée résiste', () => {
    const { bus, journal } = monter();
    bus.recevoir(DEMANDE);
    bus.rendreCaduque('req-1');
    expect(bus.demande('req-1')?.etat).toBe('caduque');
    expect(journal.contient('permission_caduque')).toBe(true);
    bus.recevoir({ ...DEMANDE, requestId: 'req-2' });
    bus.repondre('req-2', ALLOW);
    bus.confirmer('req-2');
    bus.rendreCaduque('req-2');
    expect(bus.demande('req-2')?.etat).toBe('confirmee');
  });

  test('répondre à une demande caduque n’a aucun effet', () => {
    const { bus } = monter();
    bus.recevoir(DEMANDE);
    bus.rendreCaduque('req-1');
    bus.repondre('req-1', ALLOW);
    expect(bus.demande('req-1')?.verdict).toBeNull();
  });
});

describe('BusPermissionsFactice — panne #25 (redélivrance non dédupliquée)', () => {
  test('dédup active : une redélivrance ne renotifie jamais', () => {
    const { bus, journal } = monter(true);
    bus.recevoir(DEMANDE);
    bus.redelivrer(DEMANDE);
    bus.redelivrer(DEMANDE);
    expect(bus.notificationsEmises()).toBe(1);
    expect(journal.compter('permission_dedupliquee')).toBe(2);
  });

  test('dédup inactive : chaque reconnexion renotifie l’humain', () => {
    const { bus, journal } = monter(false);
    bus.recevoir(DEMANDE);
    bus.redelivrer(DEMANDE);
    bus.redelivrer(DEMANDE);
    expect(bus.notificationsEmises()).toBe(3);
    expect(journal.compter('permission_dedupliquee')).toBe(0);
  });

  test('une demande déjà répondue voit son verdict réémis, pas renotifié', () => {
    const { bus, journal } = monter(true);
    bus.recevoir(DEMANDE);
    bus.repondre('req-1', ALLOW);
    bus.redelivrer(DEMANDE);
    expect(journal.contient('verdict_reemis')).toBe(true);
    expect(bus.notificationsEmises()).toBe(1);
  });

  test('une redélivrance d’une demande inconnue est traitée comme une arrivée', () => {
    const { bus } = monter(true);
    bus.redelivrer(DEMANDE);
    expect(bus.demande('req-1')?.etat).toBe('en_attente');
    expect(bus.notificationsEmises()).toBe(1);
  });

  test('un second recevoir du même requestId ne duplique pas la notification', () => {
    const { bus } = monter(true);
    bus.recevoir(DEMANDE);
    bus.recevoir(DEMANDE);
    expect(bus.notificationsEmises()).toBe(1);
  });
});

describe('BusPermissionsFactice — panne #24 (null sans envoi hors-bande)', () => {
  test('envoi non confirmé : la demande est bloquée indéfiniment', () => {
    const { bus, journal } = monter();
    bus.recevoir(DEMANDE);
    expect(bus.repondreHorsBande('req-1', ALLOW, false)).toBeNull();
    expect(bus.demande('req-1')?.bloqueeIndefiniment).toBe(true);
    expect(bus.demande('req-1')?.etat).toBe('en_attente');
    expect(journal.contient('null_sans_envoi_horsbande')).toBe(true);
  });

  test('envoi confirmé : le verdict est enregistré, le null est légitime', () => {
    const { bus, journal } = monter();
    bus.recevoir(DEMANDE);
    expect(bus.repondreHorsBande('req-1', ALLOW, true)).toBeNull();
    expect(bus.demande('req-1')?.etat).toBe('repondue');
    expect(bus.demande('req-1')?.bloqueeIndefiniment).toBe(false);
    expect(journal.contient('null_sans_envoi_horsbande')).toBe(false);
  });
});

describe('BusPermissionsFactice — balayage I-5', () => {
  test('répondue jamais confirmée au-delà du seuil ⇒ alerte agent bloqué', () => {
    const { horloge, bus, journal } = monter();
    bus.recevoir(DEMANDE);
    bus.repondre('req-1', ALLOW);
    horloge.avancer(30_000);
    expect(bus.balayer(60_000)).toEqual([]);
    horloge.avancer(30_000);
    expect(bus.balayer(60_000)).toEqual(['req-1']);
    expect(journal.contient('alerte_agent_bloque')).toBe(true);
  });

  test('une demande confirmée n’alerte jamais', () => {
    const { horloge, bus } = monter();
    bus.recevoir(DEMANDE);
    bus.repondre('req-1', ALLOW);
    bus.confirmer('req-1');
    horloge.avancer(10 * 60_000);
    expect(bus.balayer(60_000)).toEqual([]);
  });

  test('le scénario coupure + redélivrance + blocage est reproductible', async () => {
    const { premiere, seconde } = await rejouerDeuxFois(() => {
      const { horloge, bus, journal } = monter(true);
      bus.recevoir(DEMANDE);
      horloge.avancer(1_000);
      bus.redelivrer(DEMANDE);
      bus.repondre('req-1', ALLOW);
      horloge.avancer(120_000);
      bus.balayer(60_000);
      return journal.faits();
    });
    expect(premiere).toBe(seconde);
    expect(premiere).toContain('alerte_agent_bloque');
  });
});
