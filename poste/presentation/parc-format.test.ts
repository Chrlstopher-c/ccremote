// Responsabilité : tests du rendu en texte des sorties du parc — machines, sessions, fil lisible borné, ouverture.
import { describe, expect, test } from 'bun:test';
import type { Evenement } from '../../commun/session.ts';
import { texteFil, texteMachines, texteOuverture, texteReveil, texteSessions } from './parc-format.ts';

const heure = (ts: string): string => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const TS = '2026-11-22T10:15:00.000Z';

function evt(evenement: Evenement, seq = 1): { seq: number; ts: string; evt: Evenement } {
  return { seq, ts: TS, evt: evenement };
}

describe('texteMachines', () => {
  test('en ligne, hors ligne avec réveil possible', () => {
    const texte = texteMachines({
      machines: [
        { id: 'tour', description: 'Tour', enLigne: true, reveilPossible: false },
        { id: 'portable', description: 'Portable', enLigne: false, reveilPossible: true },
      ],
    });
    expect(texte).toContain('- tour : en ligne — Tour');
    expect(texte).toContain('- portable : hors ligne (réveil possible : parc_reveiller) — Portable');
  });

  test('aucune machine : une phrase, pas une liste vide', () => {
    expect(texteMachines({ machines: [] })).toBe('Aucune machine.');
  });
});

describe('texteSessions', () => {
  test('une ligne par session, avec le dialogue en attente et le terminal', () => {
    const texte = texteSessions({
      sessions: [
        {
          id: 's-1',
          machine: 'tour',
          titre: 'Refonte',
          projet: 'lanterne',
          statut: 'question',
          majLe: TS,
          terminal: true,
          dialogue: { id: 'd-9', titre: 'Quelle base ?' },
        },
      ],
    });
    expect(texte).toContain('- s-1 · tour:lanterne · « Refonte » · question');
    expect(texte).toContain(`activité ${heure(TS)}`);
    expect(texte).toContain('DIALOGUE d-9 en attente : « Quelle base ? »');
    expect(texte).toContain('terminal');
  });

  test('aucune session : une phrase', () => {
    expect(texteSessions({ sessions: [] })).toBe('Aucune session.');
  });
});

describe('texteFil', () => {
  test('ne garde que ce qui se lit : messages, réponses, questions, erreurs', () => {
    const texte = texteFil([
      evt({ type: 'message', texte: 'bonjour' }, 1),
      evt({ type: 'outil', id: 'o', nom: 'Bash', resume: 'ls', detail: 'ls' }, 2),
      evt({ type: 'reflexion', texte: 'pensée' }, 3),
      evt({ type: 'texte', texte: 'je regarde' }, 4),
      evt({ type: 'texte', texte: 'sous-agent', agent: 'a1' }, 5),
      evt({ type: 'question', question: 'Quelle base ?' }, 6),
      evt({ type: 'erreur', message: 'échec' }, 7),
    ]);
    expect(texte).toContain('CHRIS > bonjour');
    expect(texte).toContain('CLAUDE > je regarde');
    expect(texte).toContain('QUESTION : Quelle base ?');
    expect(texte).toContain('ERREUR : échec');
    expect(texte).not.toContain('pensée');
    expect(texte).not.toContain('sous-agent');
    expect(texte).not.toContain('Bash');
  });

  test('bornée : au plus 40 lignes, les plus récentes', () => {
    const evts = Array.from({ length: 60 }, (_, i) => evt({ type: 'message', texte: `m${i}` }, i));
    const lignes = texteFil(evts).split('\n');
    expect(lignes).toHaveLength(40);
    expect(lignes.at(-1)).toContain('m59');
  });

  test('un texte très long est coupé', () => {
    const texte = texteFil([evt({ type: 'message', texte: 'a'.repeat(2000) })]);
    expect(texte.length).toBeLessThan(600);
    expect(texte).toContain('…');
  });

  test('rien de lisible : une phrase', () => {
    expect(texteFil([evt({ type: 'tour_fini', dureeMs: 1, contexte: 0 })])).toBe('(rien de lisible dans le fil)');
  });
});

describe('texteOuverture', () => {
  test('nomme la session et sa machine', () => {
    expect(texteOuverture({ id: 's-new', machine: 'tour' })).toContain('s-new sur tour');
  });
});

describe('texteReveil', () => {
  test('nomme la machine réveillée et le poste qui a envoyé le paquet', () => {
    expect(texteReveil('tour', 'portable')).toContain('Réveil envoyé à tour (envoyé par portable)');
    expect(texteReveil('tour', undefined)).toContain('Réveil envoyé à tour.');
  });
});
