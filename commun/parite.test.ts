// Responsabilité : tests du contrat de la parité — les commandes poste s'intègrent à l'union CommandeRelais, les
// réponses du poste sont validées par leurs schémas.
import { describe, expect, test } from 'bun:test';
import { CommandeRelais } from './protocole-poste.ts';
import { GENRES_PARITE, ReponseResultatParite, ReponseTacheParite } from './parite.ts';

const CIBLE = { id: '1', sessionId: 's', claudeSessionId: 'conv', cwd: '/x' };

describe('commandes de la parité', () => {
  test("les trois commandes passent par l'union CommandeRelais", () => {
    expect(CommandeRelais.safeParse({ kind: 'parite', ...CIBLE }).success).toBe(true);
    expect(CommandeRelais.safeParse({ kind: 'parite_tache', ...CIBLE, tache: 'toolu_1' }).success).toBe(true);
    expect(CommandeRelais.safeParse({ kind: 'parite_resultat', ...CIBLE, chemin: '/a.png' }).success).toBe(true);
    expect(CommandeRelais.safeParse({ kind: 'parite', ...CIBLE, claudeSessionId: null }).success).toBe(true);
    expect(CommandeRelais.safeParse({ kind: 'parite_tache', ...CIBLE }).success).toBe(false);
  });

  test('les genres couvrent les quatre commandes', () => {
    expect([...GENRES_PARITE]).toEqual(['parite', 'parite_tache', 'parite_resultat', 'parite_fil_tache']);
  });
});

describe('réponses du poste', () => {
  test('refus de résultat : statut 404 ou 413 seulement', () => {
    expect(ReponseResultatParite.safeParse({ etat: 'refus', statut: 413, raison: 'gros' }).success).toBe(true);
    expect(ReponseResultatParite.safeParse({ etat: 'refus', statut: 500, raison: 'x' }).success).toBe(false);
    expect(ReponseResultatParite.safeParse({ etat: 'ok', mime: 'image/png', base64: 'AQ==' }).success).toBe(true);
  });

  test('tâche inconnue : tache null accepté', () => {
    expect(ReponseTacheParite.safeParse({ tache: null }).success).toBe(true);
    expect(ReponseTacheParite.safeParse({}).success).toBe(false);
  });
});
