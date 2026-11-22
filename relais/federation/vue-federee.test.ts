// Règles de la vue fusionnée : priorité du nœud en ligne, repli sur la copie locale, jamais sa propre machine.
import { describe, expect, test } from 'bun:test';
import type { VueMachine } from '../../commun/api-clients.ts';
import { ficheDe } from './banc-federation.ts';
import type { NoeudDistant } from './distant.ts';
import { fusionnerVue } from './vue-federee.ts';

function noeud(membre: string, machine: string, enLigne: boolean, ids: string[], autre?: string): NoeudDistant {
  return {
    membre,
    nom: machine,
    machine,
    enLigne,
    sessions: ids.map((id) => ficheDe(id, autre ?? machine, id)),
    vue: null,
  };
}

const machineSsh = { id: 'tour', description: 'tour', enLigne: false } as VueMachine;

function vue(noeuds: NoeudDistant[], locales = [ficheDe('ssh-1', 'tour', 'x')], machines = [machineSsh]) {
  return fusionnerVue({ locales, machinesLocales: machines, machineLocale: 'portable', noeuds, depuis: () => '' });
}

describe('fusionnerVue', () => {
  test('nœud en ligne : ses sessions remplacent les copies SSH de sa machine', () => {
    const v = vue([noeud('m1', 'tour', true, ['f-1'])]);
    expect(v.sessions.map((s) => s.id)).toEqual(['f-1']);
    expect(v.masquees.has('tour')).toBe(true);
    expect(v.machines.find((m) => m.id === 'tour')?.enLigne).toBe(true);
  });

  test('nœud hors ligne avec une copie locale : la copie SSH reprend la main', () => {
    const v = vue([noeud('m1', 'tour', false, ['f-1'])]);
    expect(v.sessions.map((s) => s.id)).toEqual(['ssh-1']);
    expect(v.routage.size).toBe(0);
  });

  test('nœud hors ligne sans copie locale : ses sessions restent, machine hors ligne', () => {
    const v = vue([noeud('m1', 'pi', false, ['f-1'])]);
    expect(v.sessions.map((s) => s.id)).toEqual(['ssh-1', 'f-1']);
    expect(v.machines.find((m) => m.id === 'pi')?.acces?.etat).toBe('injoignable');
  });

  test('jamais la machine de ce nœud reçue d’un autre ; une machine relayée cède au nœud qui la tient', () => {
    const relais = noeud('m2', 'tour', true, ['retour'], 'portable');
    const piRelaye = noeud('m3', 'mac', true, ['pi-via-mac'], 'pi');
    const piNatif = noeud('m4', 'pi', true, ['pi-natif']);
    const v = vue([relais, piRelaye, piNatif], [], []);
    expect(v.sessions.map((s) => s.id).sort()).toEqual(['pi-natif']);
    expect(v.machinesRoutees.get('pi')).toBe('m4');
  });

  test('une session déjà vue n’est pas dupliquée', () => {
    const v = vue([noeud('m1', 'tour', true, ['f-1']), noeud('m2', 'pi', true, ['f-1'], 'tour')], [], []);
    expect(v.sessions.filter((s) => s.id === 'f-1')).toHaveLength(1);
  });

  test('machine passée sur son nœud : même identifiant, la fiche du nœud remplace la copie, l’archivée reste ici', () => {
    const active = ficheDe('s-1', 'tour', 'active');
    const archivee = { ...ficheDe('s-2', 'tour', 'rangée'), archivee: true };
    const v = vue([noeud('m1', 'tour', true, ['s-1'])], [active, archivee]);
    expect(v.sessions.map((s) => s.id).sort()).toEqual(['s-1', 's-2']);
    expect(v.routage.get('s-1')).toBe('m1');
    expect(v.routage.has('s-2')).toBe(false);
    expect(v.sessions.every((s) => s.machine === 'tour')).toBe(true);
  });

  test('une copie archivée ici cède à la version vivante du nœud qui la tient (une seule fiche, routée)', () => {
    const archivee = { ...ficheDe('s-1', 'tour', 'rangée'), archivee: true };
    const v = vue([noeud('m1', 'tour', true, ['s-1'])], [archivee]);
    expect(v.sessions.filter((s) => s.id === 's-1')).toHaveLength(1);
    expect(v.sessions.find((s) => s.id === 's-1')?.archivee).toBeUndefined();
    expect(v.routage.get('s-1')).toBe('m1');
  });
});
