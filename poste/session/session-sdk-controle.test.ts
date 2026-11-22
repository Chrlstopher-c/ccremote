// Responsabilité : tests de l'état Remote Control initial d'une session SDK (interrupteur utilisable dans l'appli).
import { describe, expect, test } from 'bun:test';
import type { ResumeSession } from '../../commun/session.ts';
import { controleInitial, controlesARetablir } from './session-sdk-noyau.ts';

// Fiche partielle : seuls les champs lus par `controleInitial` comptent ici.
const fiche = (plus: Partial<ResumeSession>): ResumeSession => ({ pilotee: true, ...plus }) as ResumeSession;

describe('Remote Control initial d’une session SDK', () => {
  test('session créée par le poste, état jamais posé : éteint et connu', () => {
    expect(controleInitial(fiche({}))).toEqual({ actif: false, url: null });
    expect(controleInitial(fiche({ remoteControl: null }))).toEqual({ actif: false, url: null });
  });

  test('un Remote Control actif avant le redémarrage repart éteint (processus neuf) et est à rétablir', () => {
    const connu = { actif: true, url: 'https://exemple.test/s' };
    expect(controleInitial(fiche({ remoteControl: connu }))).toEqual({ actif: false, url: null });
    const actif = fiche({ id: 'a', remoteControl: connu });
    const eteint = fiche({ id: 'b', remoteControl: { actif: false, url: null } });
    const ailleurs = fiche({ id: 'c', remoteControl: connu, pilotee: false });
    expect(controlesARetablir([actif, eteint, ailleurs].map((resume) => ({ resume })))).toEqual(['a']);
  });

  test('session tenue ailleurs ou dans un terminal : pas d’état inventé', () => {
    expect(controleInitial(fiche({ pilotee: false }))).toBeNull();
    expect(controleInitial(fiche({ terminal: true }))).toBeNull();
  });
});
