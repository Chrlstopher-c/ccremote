// Trames reprises d'un vrai fil claude.ai (session Remote Control pilotée depuis Claude Desktop, 20/11/2026),
// réduites aux champs utiles et anonymisées.
import { describe, expect, test } from 'bun:test';
import { nouvelEtatTraduction } from '../session/traduction-sdk.ts';
import type { Evenement } from '../../commun/session.ts';
import { type PieceBrute, type StockeurPieces, traduireLot } from './traduction-distante.ts';
import type { EvenementBrut } from './donnees.ts';

const brute = (payload: unknown): EvenementBrut => ({ id: crypto.randomUUID(), payload, creeLe: '2026-11-20T00:00:00Z' });
const PNG = 'iVBORw0KGgo=';
const PDF = Buffer.from('%PDF-1.4').toString('base64');

function stockeur(): { s: StockeurPieces; vus: PieceBrute[] } {
  const vus: PieceBrute[] = [];
  const s: StockeurPieces = {
    image: (p, rang, origine) => {
      vus.push(p);
      return { type: 'image', fichier: `img${rang}`, nom: `image-${rang + 1}.png`, mime: p.mime, taille: 8, origine };
    },
    document: (p, rang, nom) => {
      vus.push(p);
      const n = nom ?? `document-${rang + 1}.pdf`;
      return { type: 'fichier', fichier: `doc${rang}`, nom: n, mime: p.mime, taille: 8, mode: 'joindre', legende: null };
    },
  };
  return { s, vus };
}

const humain = (content: unknown, extra: Record<string, unknown> = {}): unknown => ({
  type: 'user',
  uuid: 'u1',
  parent_tool_use_id: null,
  session_id: 'cse_x',
  origin: { kind: 'human' },
  message: { role: 'user', content },
  ...extra,
});
const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } };
const evts = (payloads: unknown[], pieces?: StockeurPieces): Evenement[] =>
  traduireLot(payloads.map(brute), nouvelEtatTraduction(), pieces).map((h) => h.evt);

describe('messages de Chris venus de claude.ai', () => {
  test('texte seul (chaîne)', () => {
    expect(evts([humain('Bonjour')])).toEqual([{ type: 'message', texte: 'Bonjour', uuid: 'u1' }]);
  });
  test('image seule : l’image est présentée', () => {
    const { s } = stockeur();
    expect(evts([humain([image])], s).map((e) => e.type)).toEqual(['image']);
  });
  test('images + texte (message rejoué en cours de tour) : bulle de texte puis les images', () => {
    const { s, vus } = stockeur();
    const sortie = evts([humain([image, image, { type: 'text', text: 'Regarde ça' }], { isReplay: true })], s);
    expect(sortie[0]).toEqual({ type: 'message', texte: 'Regarde ça', uuid: 'u1' });
    expect(sortie.slice(1).map((e) => (e.type === 'image' ? e.origine : e.type))).toEqual([
      'utilisateur',
      'utilisateur',
    ]);
    expect(vus).toHaveLength(2);
  });
  test('sans stockeur, une image devient une pastille et le texte reste', () => {
    expect(evts([humain([image, { type: 'text', text: 'Vu ?' }])])).toEqual([
      { type: 'message', texte: '[Image]\nVu ?', uuid: 'u1' },
    ]);
  });
  test('document PDF : fichier joint, titre gardé', () => {
    const { s } = stockeur();
    const doc = { type: 'document', title: 'devis.pdf', source: { type: 'base64', media_type: 'application/pdf', data: PDF } };
    const sortie = evts([humain([doc, { type: 'text', text: 'Lis ce devis' }])], s);
    expect(sortie.map((e) => e.type)).toEqual(['message', 'fichier']);
    expect(sortie[1]).toMatchObject({ nom: 'devis.pdf', mode: 'joindre', mime: 'application/pdf' });
  });
  test('document texte (source text) : stocké aussi', () => {
    const { s, vus } = stockeur();
    const doc = { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'notes' } };
    expect(evts([humain([doc])], s).map((e) => e.type)).toEqual(['fichier']);
    expect(Buffer.from(vus[0]?.base64 ?? '', 'base64').toString()).toBe('notes');
  });
  test('bloc inconnu : pastille neutre, le message ne disparaît jamais', () => {
    expect(evts([humain([{ type: 'container_upload', file_id: 'f' }, { type: 'text', text: 'Et ça' }])])).toEqual([
      { type: 'message', texte: '[Pièce jointe : container_upload]\nEt ça', uuid: 'u1' },
    ]);
  });
  test('chemin de fichier collé dans le texte : gardé tel quel', () => {
    expect(evts([humain('regarde /home/x/plan.md')])).toEqual([
      { type: 'message', texte: 'regarde /home/x/plan.md', uuid: 'u1' },
    ]);
  });
  test('rappel système, méta, synthétique ([Image: source…]) : pas de bulle', () => {
    const sortie = evts([
      humain('<system-reminder>x</system-reminder>'),
      humain('interne', { isMeta: true }),
      humain([{ type: 'text', text: '[Image: source: /tmp/a.png]' }], { isSynthetic: true }),
    ]);
    expect(sortie).toEqual([]);
  });
  test('commande tapée : son nom et ses arguments', () => {
    expect(evts([humain('<command-name>/compact</command-name><command-args>vite</command-args>')])).toEqual([
      { type: 'message', texte: '/compact vite', uuid: 'u1' },
    ]);
  });
  test('notification de tâche de fond : complète l’outil, pas une bulle', () => {
    const notif = humain(
      '<task-notification><task-id>b1</task-id><tool-use-id>toolu_1</tool-use-id><status>completed</status>' +
        '<summary>Agent fini</summary></task-notification>',
      { origin: { kind: 'task-notification', producer: 'session-task' } },
    );
    expect(evts([notif])).toEqual([{ type: 'resultat_outil', outilId: 'toolu_1', extrait: 'Agent fini', erreur: false }]);
  });
});

describe('tour de Claude venu de claude.ai', () => {
  const assistant = (content: unknown[], parent: string | null = null): unknown => ({
    type: 'assistant',
    uuid: 'a1',
    parent_tool_use_id: parent,
    session_id: 'cse_x',
    message: { role: 'assistant', content },
  });
  const resultat = (id: string, content: unknown, extra: Record<string, unknown> = {}): unknown => ({
    type: 'user',
    uuid: 'r1',
    parent_tool_use_id: null,
    session_id: 'cse_x',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...extra }] },
  });

  test('outil Bash : appel puis résultat en échec (exit 1)', () => {
    const sortie = evts([
      assistant([{ type: 'tool_use', id: 'toolu_b', name: 'Bash', input: { command: 'pgrep x' } }]),
      resultat('toolu_b', 'Exit code 1', { is_error: true }),
    ]);
    expect(sortie.map((e) => e.type)).toEqual(['outil', 'resultat_outil']);
    expect(sortie[1]).toMatchObject({ outilId: 'toolu_b', erreur: true });
  });
  test('agent lancé en arrière-plan : succès, pas un échec', () => {
    const lance = [{ type: 'text', text: 'Async agent launched successfully.\nagentId: a1' }];
    const sortie = evts([
      assistant([{ type: 'tool_use', id: 'toolu_a', name: 'Agent', input: { description: 'Vue', prompt: 'p' } }]),
      resultat('toolu_a', lance),
    ]);
    expect(sortie.map((e) => e.type)).toEqual(['outil', 'sous_agent', 'resultat_outil']);
    expect(sortie[2]).toMatchObject({ erreur: false });
  });
  test('résultat d’outil avec image : présentée sous l’outil', () => {
    const { s } = stockeur();
    const sortie = evts([resultat('toolu_r', [{ type: 'text', text: 'capture' }, image])], s);
    expect(sortie.map((e) => (e.type === 'image' ? `image:${e.origine}` : e.type))).toEqual([
      'resultat_outil',
      'image:outil',
    ]);
  });
  test('réflexion masquée (thinking vide) : rien ; texte : bulle de Claude', () => {
    const sortie = evts([assistant([{ type: 'thinking', thinking: '' }]), assistant([{ type: 'text', text: 'Fait.' }])]);
    expect(sortie).toEqual([{ type: 'texte', texte: 'Fait.', uuid: 'a1' }]);
  });
  test('fil d’un sous-agent : marqué de son agent, jamais une bulle de Chris', () => {
    const sortie = evts([
      assistant([{ type: 'tool_use', id: 'toolu_s', name: 'Read', input: { file_path: '/a' } }], 'toolu_a'),
      { ...(humain('consigne du sous-agent') as object), parent_tool_use_id: 'toolu_a', origin: undefined },
    ]);
    expect(sortie).toEqual([expect.objectContaining({ type: 'outil', agent: 'toolu_a' })]);
  });
});
