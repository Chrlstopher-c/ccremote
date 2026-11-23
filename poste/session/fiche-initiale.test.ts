import { describe, expect, test } from 'bun:test';
import type { DemandeSession } from '../../commun/session.ts';
import type { ConfigPoste } from '../config.ts';
import { resumeInitial } from './fiche-initiale.ts';

// Seuls ces champs sont lus par resumeInitial.
const CONFIG = { machine: 'pc', fenetreContexte: 200_000 } as unknown as ConfigPoste;
const demande = (extra: Partial<DemandeSession>): DemandeSession =>
  ({
    sessionId: 's-1',
    projet: { machine: 'pc', chemin: '/e', nom: 'e' },
    titre: 't',
    objectif: null,
    autonomie: false,
    ...extra,
  }) as unknown as DemandeSession;
const RELAIS = { url: 'http://127.0.0.1:1/claude', jeton: 'j'.repeat(43) };
const INVITE = {
  membre: 'aaaaaaaaaaaa',
  nom: 'pc',
  espace: '/e',
  config: '/c',
  lecture: [],
  prompt: '',
  remoteControl: false,
};

describe('fiche de départ', () => {
  test('invité chez lui en « Ignorer les permissions » : le mode est posé dès la fiche (sinon il démarrait en Manuel)', () => {
    const r = resumeInitial(
      CONFIG,
      demande({ mode: 'bypassPermissions', invite: { ...INVITE, relais: RELAIS } }),
      '/e',
      'principal',
    );
    expect(r.mode).toBe('bypassPermissions');
  });

  test('session ordinaire : mode absent (= Ignorer, convention existante), appliqué ensuite par les réglages', () => {
    expect(resumeInitial(CONFIG, demande({ mode: 'plan' }), '/e', 'principal').mode).toBeUndefined();
  });
});
