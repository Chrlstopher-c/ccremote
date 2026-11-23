import { describe, expect, test } from 'bun:test';
import type { ResumeSession } from '../../commun/session.ts';
import type { VueMachine } from '../../commun/api-clients.ts';
import type { VueFederee } from '../federation/vue-federee.ts';
import { vueParc } from './api.ts';

// Seuls les identifiants comptent ici : le reste des fiches n'est pas lu par vueParc.
const machine = (id: string): VueMachine => ({ id }) as unknown as VueMachine;
const session = (id: string): ResumeSession => ({ id }) as unknown as ResumeSession;

const V: VueFederee = {
  machines: [machine('pc-invite'), machine('machine-du-chef')],
  sessions: [session('a-moi'), session('du-chef')],
  routage: new Map([['du-chef', 'chef']]),
  machinesRoutees: new Map([['machine-du-chef', 'chef']]),
  masquees: new Set(),
};

describe('vue du parc', () => {
  test('nœud invité (local) : ni la machine ni les sessions du chef ne sont proposées', () => {
    const v = vueParc(V, true);
    expect(v.machines.map((m) => m.id)).toEqual(['pc-invite']);
    expect(v.sessions.map((s) => s.id)).toEqual(['a-moi']);
  });

  test('nœud ordinaire : tout le parc fédéré', () => {
    expect(vueParc(V, false).machines).toHaveLength(2);
  });
});
