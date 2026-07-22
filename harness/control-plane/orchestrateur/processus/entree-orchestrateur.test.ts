/**
 * Tests de l'attribution structurelle de l'émetteur à l'entrée de l'orchestrateur
 * (préservation de H-66, cf. en-tête de `entree-orchestrateur.ts`).
 */
import { describe, expect, test } from 'bun:test';
import { EntreeOrchestrateur, formaterMessageAttribue } from './entree-orchestrateur.ts';

function texteDuMessage(message: { message: { content: unknown } }): string {
  return message.message.content as string;
}

describe('formaterMessageAttribue', () => {
  test('préfixe structurel distinct pour operateur et systeme', () => {
    expect(formaterMessageAttribue('operateur', 'lance X')).toBe('[emetteur:operateur] lance X');
    expect(formaterMessageAttribue('systeme', 'incident Y')).toBe('[emetteur:systeme] incident Y');
  });
});

describe('EntreeOrchestrateur — aucune porte non étiquetée', () => {
  test('envoyerOperateur porte le préfixe operateur', async () => {
    const entree = new EntreeOrchestrateur();
    await entree.envoyerOperateur('crée une équipe sur projet-alpha');
    const iterateur = entree.flux[Symbol.asyncIterator]();
    const { value } = await iterateur.next();
    expect(texteDuMessage(value as never)).toBe('[emetteur:operateur] crée une équipe sur projet-alpha');
    entree.fermer();
  });

  test('envoyerSysteme porte le préfixe systeme — jamais confondu avec une parole de Chris', async () => {
    const entree = new EntreeOrchestrateur();
    await entree.envoyerSysteme('réconciliation : 1 orphelin adopté');
    const iterateur = entree.flux[Symbol.asyncIterator]();
    const { value } = await iterateur.next();
    expect(texteDuMessage(value as never)).toBe('[emetteur:systeme] réconciliation : 1 orphelin adopté');
    entree.fermer();
  });

  test('fermer() est une fermeture EXPLICITE — jamais surFermetureImprevue', async () => {
    let alarmeDeclenchee = false;
    const entree = new EntreeOrchestrateur({ surFermetureImprevue: () => (alarmeDeclenchee = true) });
    entree.fermer();
    expect(entree.etat).toBe('ferme');
    expect(alarmeDeclenchee).toBe(false);
  });

  test('☠ un consommateur qui abandonne le flux (return()) déclenche l’alarme — pas fermer()', async () => {
    let contexte: unknown = null;
    const entree = new EntreeOrchestrateur({ surFermetureImprevue: (c) => (contexte = c) });
    const iterateur = entree.flux[Symbol.asyncIterator]();
    await iterateur.return?.();
    expect(entree.etat).toBe('ferme_implicitement');
    expect(contexte).not.toBeNull();
  });
});
