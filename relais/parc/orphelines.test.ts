// Responsabilité : tests de l'adoption des fiches orphelines — une fiche dont la conversation figure dans les
// transcripts du poste qui s'annonce, et que ce poste n'annonce plus, lui est confiée (commande `adopter`).
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { type DonneesPoste, Postes } from './postes.ts';

const journal = pino({ enabled: false });
const MAJ = '2026-11-18T10:00:00.000Z';

function session(id: string, extra: Partial<ResumeSession> = {}): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: id,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'fermee',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
    ...extra,
  };
}

interface Montage {
  readonly postes: Postes;
  readonly registre: Registre;
  readonly poste: ServerWebSocket<DonneesPoste>;
  readonly envoyes: string[];
}

// Le poste « tour » connecté : ses envois (commandes) sont relevés ; les fiches déjà au relais sont données.
function montage(fiches: readonly ResumeSession[]): Montage {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  for (const f of fiches) registre.enregistrerSession(f);
  const diffusion = new Diffusion();
  diffusion.ajouter({ send: () => undefined } as unknown as ServerWebSocket<unknown>);
  const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
  const envoyes: string[] = [];
  const poste = {
    data: { machine: 'tour' },
    send: (texte: string) => envoyes.push(texte),
    close: () => undefined,
  } as unknown as ServerWebSocket<DonneesPoste>;
  postes.ouvert(poste);
  return { postes, registre, poste, envoyes };
}

// Le poste s'annonce ; `transcripts` absent : le poste d'avant ne dit pas ses transcripts.
function bonjour(m: Montage, transcripts?: readonly string[], annoncees: ResumeSession[] = []): void {
  m.postes.recu(
    m.poste,
    JSON.stringify({
      kind: 'bonjour',
      version: 'test',
      description: 'tour',
      racines: [],
      projets: [],
      comptes: ['defaut'],
      sessions: annoncees,
      ...(transcripts ? { transcripts } : {}),
    }),
  );
}

function adoptions(envoyes: readonly string[]): { kind: string; sessionId: string; id: string }[] {
  return envoyes
    .map((e) => JSON.parse(e) as { kind: string; sessionId: string; id: string })
    .filter((c) => c.kind === 'adopter');
}

describe('fiche orpheline adoptée par son poste', () => {
  test('conversation présente dans les transcripts du poste, fiche non annoncée : commande adopter', () => {
    const m = montage([session('c1')]);
    bonjour(m, ['c1']);
    const envoyees = adoptions(m.envoyes);
    expect(envoyees).toHaveLength(1);
    expect(envoyees[0]?.sessionId).toBe('c1');
    // Réponse du poste : la commande ne reste pas en attente.
    m.postes.recu(m.poste, JSON.stringify({ kind: 'reponse', id: envoyees[0]?.id ?? '', ok: true }));
  });

  test('une fiche que le poste annonce encore n’est pas adoptée', () => {
    const m = montage([session('c1')]);
    bonjour(m, ['c1'], [session('c1')]);
    expect(adoptions(m.envoyes)).toEqual([]);
  });

  test('une fiche dont la conversation n’est dans aucun transcript du poste n’est pas adoptée', () => {
    const m = montage([session('c1')]);
    bonjour(m, ['autre']);
    expect(adoptions(m.envoyes)).toEqual([]);
  });

  test('une session distante (Remote Control) n’est jamais adoptée', () => {
    const distante = session('cse_abc', {
      distant: { compte: 'principal', idDistant: 'cse_abc', connexion: 'connectee', probleme: null },
    });
    const m = montage([distante]);
    bonjour(m, ['cse_abc']);
    expect(adoptions(m.envoyes)).toEqual([]);
  });

  test('une fiche d’une autre machine n’est pas adoptée par ce poste', () => {
    const m = montage([session('p1', { machine: 'portable' })]);
    bonjour(m, ['p1']);
    expect(adoptions(m.envoyes)).toEqual([]);
  });

  test('sans liste de transcripts (poste d’avant), rien n’est adopté', () => {
    const m = montage([session('c1')]);
    bonjour(m);
    expect(adoptions(m.envoyes)).toEqual([]);
  });
});
