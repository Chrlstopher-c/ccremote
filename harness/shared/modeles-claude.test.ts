import { describe, expect, test } from 'bun:test';
import { effortsDe, MODELES, normaliserModele, trouverModele } from './modeles-claude.ts';

describe('☠ normalisation du modèle — la panne du 31/07', () => {
  test('« sonnet 5 » : LA chaîne qui a tué une équipe deux secondes après son démarrage', () => {
    expect(normaliserModele('sonnet 5')).toBe('claude-sonnet-5');
  });

  test('les autres formes qu’un modèle écrit spontanément', () => {
    expect(normaliserModele('Sonnet-5')).toBe('claude-sonnet-5');
    expect(normaliserModele('opus 4.8')).toBe('claude-opus-4-8');
    expect(normaliserModele('  Opus_5  ')).toBe('claude-opus-5');
    // ☠ Normaliser n'est pas garantir la disponibilité : `claude-opus-5` est une
    // forme VALIDE que ce CLI n'expose pas. Le refus viendra du CLI, en clair.
    expect(normaliserModele('haiku 4.5')).toBe('claude-haiku-4-5');
  });

  test('un alias nu passe tel quel — le CLI les accepte', () => {
    expect(normaliserModele('opus')).toBe('opus');
    expect(normaliserModele('sonnet')).toBe('sonnet');
    expect(normaliserModele('fable')).toBe('fable');
  });

  test('un identifiant complet n’est jamais réécrit', () => {
    expect(normaliserModele('claude-opus-5')).toBe('claude-opus-5');
    expect(normaliserModele('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5-20251001');
  });

  test('☠ le suffixe de variante est PRÉSERVÉ — le retirer changerait la fenêtre de contexte', () => {
    expect(normaliserModele('opus[1m]')).toBe('opus[1m]');
    expect(normaliserModele('claude-opus-5[1m]')).toBe('claude-opus-5[1m]');
  });

  test('ce qui ne désigne rien est REFUSÉ, pas passé au CLI en espérant', () => {
    expect(normaliserModele('le plus intelligent')).toBeNull();
    expect(normaliserModele('gpt-5')).toBeNull();
    expect(normaliserModele('')).toBeNull();
    expect(normaliserModele('   ')).toBeNull();
  });
});

describe('efforts par modèle — la liste n’est pas uniforme', () => {
  test('☠ Haiku n’accepte AUCUN effort — le lui proposer produirait une option qui échoue', () => {
    expect(effortsDe('claude-haiku-4-5')).toEqual([]);
  });

  test('☠ l’identifiant DATÉ et sa forme courte désignent le même modèle', () => {
    // Sans cette tolérance, `claude-haiku-4-5` tombait dans le repli « inconnu »
    // et se voyait proposer cinq niveaux d'effort qu'il refuse.
    expect(effortsDe('claude-haiku-4-5-20251001')).toEqual([]);
    expect(trouverModele('claude-haiku-4-5-20251001')?.libelle).toBe('Haiku 4.5');
  });

  test('les modèles mesurés ont les cinq niveaux, `max` compris', () => {
    expect(effortsDe('claude-opus-5')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortsDe('claude-sonnet-5')).toContain('xhigh');
    expect(effortsDe('claude-fable-5')).toContain('max');
  });

  test('☠ modèle inconnu ⇒ liste complète, jamais vide — refuser sur une ignorance coûte de la capacité', () => {
    expect(effortsDe('claude-modele-de-demain')).toHaveLength(5);
  });

  test('la variante ne fait pas perdre le modèle de vue', () => {
    expect(trouverModele('opus[1m]')?.id).toBe('claude-opus-5');
    expect(effortsDe('claude-haiku-4-5[1m]')).toEqual([]);
  });
});

describe('cohérence du catalogue', () => {
  test('tout modèle qui accepte un effort en propose un par défaut, et l’inverse', () => {
    for (const m of MODELES) {
      if (m.effortDefaut === null) expect(m.efforts).toHaveLength(0);
      else expect(m.efforts).toContain(m.effortDefaut);
    }
  });

  test('chaque alias déclaré se normalise vers lui-même', () => {
    for (const m of MODELES) {
      if (m.alias !== null) expect(normaliserModele(m.alias)).toBe(m.alias);
    }
  });
});
