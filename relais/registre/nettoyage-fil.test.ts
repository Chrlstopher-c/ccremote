// Responsabilité : tests du nettoyage du fil au recalage — notifications de tâche rangées en bulle et doublons retirés
// (première occurrence gardée), sur la liste pure puis sur une base en mémoire (seule la session visée est touchée).
import { describe, expect, test } from 'bun:test';
import type { Evenement } from '../../commun/session.ts';
import { ouvrirBase } from './base.ts';
import { estNotificationEnBulle, type LignesTranscript, lignesARetirer, nettoyerFil } from './nettoyage-fil.ts';

const T = (n: number): string => `2026-11-18T10:${String(n).padStart(2, '0')}:00.000Z`;
const msg = (texte: string, uuid?: string): Evenement =>
  uuid ? { type: 'message', texte, uuid } : { type: 'message', texte };
const NOTIFICATION = '<task-notification>tâche terminée</task-notification>';

describe('lignesARetirer', () => {
  test('de deux lignes identiques, la première est gardée et la seconde retirée', () => {
    const lignes = [
      { seq: 1, ts: T(1), evt: msg('un', 'a') },
      { seq: 2, ts: T(1), evt: msg('un', 'a') },
    ];
    expect(lignesARetirer(lignes)).toEqual([2]);
  });

  test('une notification de tâche écrite en message est retirée, même précédée d’espaces', () => {
    const lignes = [
      { seq: 1, ts: T(1), evt: msg('un', 'a') },
      { seq: 2, ts: T(2), evt: msg(`   ${NOTIFICATION}`) },
    ];
    expect(lignesARetirer(lignes)).toEqual([2]);
  });

  test('des messages distincts sont tous gardés, un texte qui ne commence pas par la balise aussi', () => {
    const lignes = [
      { seq: 1, ts: T(1), evt: msg('un', 'a') },
      { seq: 2, ts: T(2), evt: msg('deux', 'b') },
      { seq: 3, ts: T(3), evt: msg(`le mot ${NOTIFICATION} cité au milieu`) },
    ];
    expect(lignesARetirer(lignes)).toEqual([]);
  });
});

describe('estNotificationEnBulle', () => {
  test('seul un message commençant par la balise est une notification en bulle', () => {
    expect(estNotificationEnBulle(msg(NOTIFICATION))).toBe(true);
    expect(estNotificationEnBulle({ type: 'texte', texte: NOTIFICATION })).toBe(false);
  });
});

describe('nettoyerFil', () => {
  test('retire doublons et notifications de la session visée, rend leur nombre, ne touche pas les autres', () => {
    const db = ouvrirBase(':memory:');
    try {
      const inserer = db.query('INSERT INTO evenements (session_id, ts, evt) VALUES (?, ?, ?)');
      inserer.run('s', T(1), JSON.stringify(msg('un', 'a')));
      inserer.run('s', T(1), JSON.stringify(msg('un', 'a')));
      inserer.run('s', T(2), JSON.stringify(msg(NOTIFICATION)));
      inserer.run('s', T(3), JSON.stringify(msg('trois', 'c')));
      inserer.run('autre', T(1), JSON.stringify(msg('un', 'a')));
      inserer.run('autre', T(1), JSON.stringify(msg('un', 'a')));

      expect(nettoyerFil(db, 's')).toBe(2);

      // Lignes lues telles qu'écrites (évènement sérialisé en JSON) : le cast ne sert qu'à typer la requête.
      const restants = (session: string): unknown[] =>
        (
          db.query('SELECT evt FROM evenements WHERE session_id = ? ORDER BY seq').all(session) as { evt: string }[]
        ).map((l) => JSON.parse(l.evt) as unknown);
      expect(restants('s')).toEqual([msg('un', 'a'), msg('trois', 'c')]);
      expect(restants('autre')).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  test('un fil sans doublon ni notification : rien n’est retiré', () => {
    const db = ouvrirBase(':memory:');
    try {
      const inserer = db.query('INSERT INTO evenements (session_id, ts, evt) VALUES (?, ?, ?)');
      inserer.run('s', T(1), JSON.stringify(msg('un', 'a')));
      expect(nettoyerFil(db, 's')).toBe(0);
    } finally {
      db.close();
    }
  });
});

// Lignes étrangères au transcript (recalage) : outil, texte ou message du fil principal absent du transcript et daté
// jusqu'à `jusqua` ; un écho sans uuid part quand le transcript porte son texte, ou un message avec uuid proche.
type LigneBrute = { seq: number; ts: string; evt: Evenement };
const ligne = (seq: number, ts: string, evt: Evenement): LigneBrute => ({ seq, ts, evt });
const outil = (id: string, agent?: string): Evenement => ({
  type: 'outil',
  id,
  nom: 'Bash',
  resume: 'ls',
  detail: '',
  ...(agent ? { agent } : {}),
});
const transcriptTest = (cles: string[], messages: string[] = [], jusqua = T(5)): LignesTranscript => ({
  cles: new Set(cles),
  messages: new Set(messages),
  jusqua,
});

describe('lignesARetirer — lignes étrangères au transcript', () => {
  test('outil, texte et message absents du transcript, datés jusqu’à jusqua (limite comprise), sont retirés', () => {
    const lignes = [
      ligne(1, T(1), outil('o-etranger')),
      ligne(2, T(2), { type: 'texte', texte: 'étranger', uuid: 'u-etranger' }),
      ligne(3, T(3), msg('étranger', 'm-etranger')),
      ligne(4, T(4), msg('connu', 'u-connu')),
      ligne(5, T(5), outil('o-bord')),
    ];
    expect(lignesARetirer(lignes, transcriptTest(['u-connu']))).toEqual([1, 2, 3, 5]);
  });

  test('une ligne datée après jusqua n’est pas jugée étrangère', () => {
    expect(lignesARetirer([ligne(1, T(7), outil('o-recent'))], transcriptTest(['u-connu']))).toEqual([]);
  });

  test('sans clé relue au transcript, rien n’est jugé étranger', () => {
    expect(lignesARetirer([ligne(1, T(1), outil('o-x'))], transcriptTest([]))).toEqual([]);
  });

  test('un événement de sous-agent (agent renseigné) n’est jamais retiré par cette règle', () => {
    const lignes = [
      ligne(1, T(1), outil('o-sa', 'ag-1')),
      ligne(2, T(2), { type: 'texte', texte: 'réponse', uuid: 'u-sa', agent: 'ag-1' }),
    ];
    expect(lignesARetirer(lignes, transcriptTest(['u-connu']))).toEqual([]);
  });

  test('un message sans uuid est retiré si le transcript porte son texte, gardé sinon ou s’il est postérieur', () => {
    const lignes = [
      ligne(1, T(1), msg('déjà au transcript')),
      ligne(2, T(2), msg('écrit en direct')),
      ligne(3, T(9), msg('déjà au transcript')),
    ];
    expect(lignesARetirer(lignes, transcriptTest(['u-connu'], ['déjà au transcript']))).toEqual([1]);
  });

  test('sans transcript, un écho sans uuid part quand un message avec uuid de même texte est à moins de 10 min', () => {
    expect(lignesARetirer([ligne(1, T(1), msg('bonjour')), ligne(2, T(3), msg('bonjour', 'u-1'))])).toEqual([1]);
  });

  test('au-delà de 10 min, l’écho sans uuid est gardé', () => {
    const lignes = [
      ligne(1, '2026-11-18T10:00:00.000Z', msg('bonjour')),
      ligne(2, '2026-11-18T10:11:00.000Z', msg('bonjour', 'u-1')),
    ];
    expect(lignesARetirer(lignes)).toEqual([]);
  });
});
