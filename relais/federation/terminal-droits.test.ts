// Responsabilité : les droits de la charte appliqués aux terminaux — un pair (ou un invité, sans droit) ou un
// appareil sans `piloter` n'ouvre aucun terminal sur ce nœud ; avec le droit, l'ouverture passe comme avant.
import { expect, test } from 'bun:test';
import pino from 'pino';
import type { MessageChiffre } from '../../commun/federation.ts';
import type { RequeteDroit } from '../../commun/charte.ts';
import type { CanalNoeud } from './canal.ts';
import type { ClientTerminal } from '../appareils/terminaux.ts';
import type { Echanges } from './echanges.ts';
import { TerminalAppareil } from './terminal-appareil.ts';
import { ficheDe } from './banc-federation.ts';
import { TerminalFedere, type TerminauxLocaux } from './terminal-federe.ts';

const SANS_DROIT = 'pair-sans-droit';
const AVEC_DROIT = 'pair-avec-droit';
const REF = '6f1d2c3e-0000-4000-8000-0000000000aa';
const TERMINAL = '6f1d2c3e-0000-4000-8000-0000000000bb';

/** Droit simulé : seul `SANS_DROIT` n'a pas le droit de terminal (un invité y est aussi refusé par la charte). */
function autorise(membre: string, requete: RequeteDroit): boolean {
  return !(membre === SANS_DROIT && requete.genre === 'terminal');
}

/** Canal minimal : seuls `membre` et `envoyer` sont lus ici. */
function canalDe(membre: string, envoyes: MessageChiffre[]): CanalNoeud {
  // Fake de test : le canal réel a bien plus de champs, qui ne sont pas lus par ces chemins.
  return {
    membre,
    envoyer: (m: MessageChiffre) => {
      envoyes.push(m);
      return true;
    },
  } as unknown as CanalNoeud;
}

/** Échanges minimaux : `reponse` garde ce qui serait renvoyé à la place du pair. */
function echangesDe(envoyes: MessageChiffre[]): Echanges {
  // Fake de test : seule la réponse `reponse` est appelée sur ce chemin.
  return {
    reponse: (canal: CanalNoeud, ref: string, ok: boolean, raison?: string) =>
      envoyes.push({ t: 'reponse', ref, ok, ...(raison !== undefined ? { raison } : {}) }),
  } as unknown as Echanges;
}

function locauxDe(ouverts: string[]): TerminauxLocaux {
  return {
    ouvert: async (ws: ClientTerminal) => {
      ouverts.push(ws.data.terminal);
      return true;
    },
    recu: () => undefined,
    ferme: () => undefined,
  };
}

const journal = pino({ enabled: false });

/** Laisse la réponse asynchrone du terminal arriver (l'ouverture attend le PTY). */
const attendre = () => new Promise<void>((resoudre) => setTimeout(resoudre, 10));

function terminalFedere(envoyes: MessageChiffre[], ouverts: string[]): TerminalFedere {
  const terminaux = new TerminalFedere({
    echanges: echangesDe(envoyes),
    canaux: { liaisonOuverteAvec: () => null },
    registre: { session: () => ficheDe('s1', 'tour', 'Terminal') },
    journal,
    autorise,
  });
  terminaux.brancher(locauxDe(ouverts));
  return terminaux;
}

const OUVRIR = {
  t: 'terminal_ouvrir',
  ref: REF,
  terminal: TERMINAL,
  session: 's1',
  colonnes: 80,
  lignes: 24,
} as const;

test('un pair sans droit de terminal voit son ouverture refusée, sans PTY ouvert', async () => {
  const envoyes: MessageChiffre[] = [];
  const ouverts: string[] = [];
  terminalFedere(envoyes, ouverts).traiter(canalDe(SANS_DROIT, envoyes), OUVRIR);
  await attendre();
  expect(ouverts).toEqual([]);
  expect(envoyes).toEqual([{ t: 'reponse', ref: REF, ok: false, raison: 'droit refusé : piloter' }]);
});

test('un pair avec le droit ouvre le terminal de la session comme avant', async () => {
  const envoyes: MessageChiffre[] = [];
  const ouverts: string[] = [];
  terminalFedere(envoyes, ouverts).traiter(canalDe(AVEC_DROIT, envoyes), OUVRIR);
  await attendre();
  expect(ouverts).toEqual([TERMINAL]);
  expect(envoyes).toEqual([{ t: 'reponse', ref: REF, ok: true }]);
});

test('un appareil sans droit n’ouvre pas de terminal de machine ; avec le droit, il l’ouvre', async () => {
  const envoyes: MessageChiffre[] = [];
  const ouverts: string[] = [];
  const machine = new TerminalAppareil(() => locauxDe(ouverts), autorise);
  const ouverture = {
    t: 'terminal_poste',
    ref: REF,
    terminal: TERMINAL,
    machine: 'tour',
    cible: { type: 'shell' },
    colonnes: 80,
    lignes: 24,
  } as const;
  await machine.ouvrir(canalDe(SANS_DROIT, envoyes), ouverture);
  expect(ouverts).toEqual([]);
  expect(envoyes).toEqual([{ t: 'reponse', ref: REF, ok: false, raison: 'droit refusé : piloter' }]);
  await machine.ouvrir(canalDe(AVEC_DROIT, envoyes), ouverture);
  expect(ouverts).toEqual([TERMINAL]);
  expect(envoyes.at(-1)).toEqual({ t: 'reponse', ref: REF, ok: true, raison: undefined });
});
