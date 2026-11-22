// Responsabilité : tests de l'état Remote Control initial d'une session SDK (interrupteur utilisable dans l'appli).
import { describe, expect, test } from 'bun:test';
import type { ResumeSession } from '../../commun/session.ts';
import { controleInitial } from './session-sdk-noyau.ts';

// Fiche partielle : seuls les champs lus par `controleInitial` comptent ici.
const fiche = (plus: Partial<ResumeSession>): ResumeSession => ({ pilotee: true, ...plus }) as ResumeSession;

describe('Remote Control initial d’une session SDK', () => {
  test('session créée par le poste, état jamais posé : éteint et connu', () => {
    expect(controleInitial(fiche({}))).toEqual({ actif: false, url: null });
    expect(controleInitial(fiche({ remoteControl: null }))).toEqual({ actif: false, url: null });
  });

  test('un état déjà connu est gardé', () => {
    const connu = { actif: true, url: 'https://exemple.test/s' };
    expect(controleInitial(fiche({ remoteControl: connu }))).toBe(connu);
  });

  test('session tenue ailleurs ou dans un terminal : pas d’état inventé', () => {
    expect(controleInitial(fiche({ pilotee: false }))).toBeNull();
    expect(controleInitial(fiche({ terminal: true }))).toBeNull();
  });
});
