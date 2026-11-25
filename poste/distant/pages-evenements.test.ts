// Responsabilité : tests de la lecture des pages d'un fil claude.ai (bornes en événements affichables).
import { describe, expect, test } from 'bun:test';
import type { EvenementBrut, PageEvenements } from './donnees.ts';
import { type BornesLecture, lireFil } from './pages-evenements.ts';
import type { ResultatApi } from './client-claude-ai.ts';

const humain = (n: number): EvenementBrut => ({
  id: `h${n}`,
  creeLe: null,
  payload: { type: 'user', message: { role: 'user', content: `m${n}` }, origin: { kind: 'human' } },
});
const systeme = (n: number): EvenementBrut => ({
  id: `s${n}`,
  creeLe: null,
  payload: { type: 'system', subtype: 'x' },
});

// Fil de `total` événements, une page de `taille` par appel ; un événement sur `systemeTous` est système (0 : aucun).
type Lecteur = (curseur: string | null) => Promise<ResultatApi<PageEvenements>>;

function fil(total: number, taille: number, systemeTous: number): Lecteur {
  const suivant = (curseur: string | null): number => (curseur === null ? 0 : Number(curseur));
  return async (curseur) => {
    const debut = suivant(curseur);
    const evenements: EvenementBrut[] = [];
    for (let n = debut; n < Math.min(total, debut + taille); n++) {
      const estSysteme = systemeTous > 0 && n % systemeTous === 0;
      evenements.push(estSysteme ? systeme(n) : humain(n));
    }
    const fin = debut + evenements.length;
    return { ok: true, donnees: { evenements, suivant: fin < total ? String(fin) : null } };
  };
}

const bornes = (p: Partial<BornesLecture>): BornesLecture => ({
  pages: 40,
  affichables: Infinity,
  dejaConnu: () => false,
  ...p,
});

describe('lecture des pages d’un fil claude.ai', () => {
  test('la borne compte les événements affichables : les systèmes ne l’entament pas', async () => {
    // Un événement sur deux est système : 400 affichables demandent 800 événements bruts (8 pages de 100).
    const r = await lireFil(fil(5_000, 100, 2), bornes({ affichables: 400 }));
    if (!r.ok) throw new Error('lecture en échec');
    const affichables = r.donnees.filter((e) => e.payload && (e.payload as { type: string }).type !== 'system');
    expect(affichables).toHaveLength(400);
    expect(r.donnees.length).toBe(800);
  });

  test('un fil plus court que la borne est lu jusqu’au bout', async () => {
    const r = await lireFil(fil(150, 100, 0), bornes({ affichables: 400 }));
    if (!r.ok) throw new Error('lecture en échec');
    expect(r.donnees).toHaveLength(150);
  });

  test('le plafond de pages arrête la lecture même si la borne n’est pas atteinte', async () => {
    const r = await lireFil(fil(5_000, 100, 0), bornes({ pages: 4, affichables: 400 }));
    if (!r.ok) throw new Error('lecture en échec');
    expect(r.donnees).toHaveLength(400);
  });

  test('un événement déjà connu arrête la lecture (suivi direct)', async () => {
    const r = await lireFil(fil(500, 100, 0), bornes({ dejaConnu: (id) => id === 'h7' }));
    if (!r.ok) throw new Error('lecture en échec');
    expect(r.donnees.map((e) => e.id)).toEqual(['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  });

  test('une erreur de page est rendue telle quelle', async () => {
    const echec: Lecteur = async () => ({ ok: false, statut: 500, probleme: 'panne' });
    const r = await lireFil(echec, bornes({}));
    expect(r.ok).toBe(false);
  });
});
