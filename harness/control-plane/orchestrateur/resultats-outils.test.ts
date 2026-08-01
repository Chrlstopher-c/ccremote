/**
 * `☠` Le fil de l'orchestrateur affichait « Outil appelé : lire_fichier » et,
 * dessous, « Le harness journalise l'appel, pas son résultat (H-45) ». Verdict de
 * Chris le 01/08 : ça ne sert à rien. Il a raison — savoir qu'un outil a tourné
 * sans savoir ce qu'il a rendu n'apprend rien, et masque en particulier les
 * outils qui ont ÉCHOUÉ.
 *
 * `☠` H-45 était de surcroît mal invoquée : elle interdit au flux des SOUS-AGENTS
 * de traverser le contexte de l'orchestrateur. Ici il s'agit de ses propres
 * appels, déjà dans son contexte puisqu'il les a lancés. La règle protégeait
 * quelque chose qui n'était pas en jeu, au prix de la lisibilité du fil.
 */

import { describe, expect, test } from 'bun:test';
import { appelsDe, borner, MAX_RESULTAT, resultatsDe } from './resultats-outils.ts';

const assistant = (blocs: unknown[]): unknown => ({ type: 'assistant', message: { content: blocs } });
const utilisateur = (blocs: unknown[]): unknown => ({ type: 'user', message: { content: blocs } });

describe('lecture des appels d’outils', () => {
  test('nom, identifiant et paramètres sont extraits', () => {
    const [appel] = appelsDe(assistant([{ type: 'tool_use', id: 'toolu_1', name: 'lire_fichier', input: { chemin: '/a.ts' } }]));
    expect(appel?.nom).toBe('lire_fichier');
    expect(appel?.toolUseId).toBe('toolu_1');
    expect(appel?.detail).toContain('/a.ts');
  });

  test('☠ un appel SANS identifiant reste extrait, seulement non appariable', () => {
    // Exiger l'id ferait DISPARAÎTRE l'appel du fil : on perdrait l'information
    // certaine (« cet outil a tourné ») pour protéger l'incertaine (son résultat).
    const [appel] = appelsDe(assistant([{ type: 'tool_use', name: 'carburant_parc' }]));
    expect(appel?.nom).toBe('carburant_parc');
    expect(appel?.toolUseId).toBeNull();
  });

  test('un outil sans paramètre rend un détail vide, jamais « {} »', () => {
    const [appel] = appelsDe(assistant([{ type: 'tool_use', id: 't', name: 'mon_autonomie', input: {} }]));
    expect(appel?.detail).toBe('');
  });

  test('des paramètres non sérialisables ne font pas perdre l’appel', () => {
    const cyclique: Record<string, unknown> = {};
    cyclique['soi'] = cyclique;
    const [appel] = appelsDe(assistant([{ type: 'tool_use', id: 't', name: 'x', input: cyclique }]));
    expect(appel?.nom).toBe('x');
    expect(appel?.detail).toContain('illisibles');
  });
});

describe('lecture des résultats d’outils', () => {
  test('☠ les résultats vivent dans les messages `user`, pas `assistant`', () => {
    // LA raison pour laquelle ils n'ont jamais été captés : le collecteur ne
    // regardait que les messages assistant. Il ne pouvait pas les voir.
    expect(resultatsDe(assistant([{ type: 'tool_result', tool_use_id: 't', content: 'x' }]))).toEqual([]);
    expect(resultatsDe(utilisateur([{ type: 'tool_result', tool_use_id: 't', content: 'x' }])).length).toBe(1);
  });

  test('les deux formes de contenu du SDK sont aplaties', () => {
    const chaine = resultatsDe(utilisateur([{ type: 'tool_result', tool_use_id: 'a', content: 'brut' }]));
    expect(chaine[0]?.contenu).toBe('brut');
    const blocs = resultatsDe(
      utilisateur([{ type: 'tool_result', tool_use_id: 'b', content: [{ type: 'text', text: 'un' }, { type: 'text', text: 'deux' }] }]),
    );
    expect(blocs[0]?.contenu).toBe('un\ndeux');
  });

  test('☠ un échec d’outil est signalé, jamais rendu comme une réponse normale', () => {
    // Sans ce drapeau, un outil qui a planté se relit comme un outil qui a
    // répondu — et on croit disposer d'une information jamais obtenue.
    const [r] = resultatsDe(utilisateur([{ type: 'tool_result', tool_use_id: 'a', content: 'boom', is_error: true }]));
    expect(r?.erreur).toBe(true);
  });

  test('l’appariement se fait par identifiant, pas par position', () => {
    // Un tour peut lancer plusieurs outils en parallèle : les résultats
    // reviennent dans l'ordre où ils finissent, pas où ils ont été lancés.
    const rs = resultatsDe(
      utilisateur([
        { type: 'tool_result', tool_use_id: 'second', content: 'B' },
        { type: 'tool_result', tool_use_id: 'premier', content: 'A' },
      ]),
    );
    expect(rs.map((r) => r.toolUseId)).toEqual(['second', 'premier']);
  });
});

describe('bornage', () => {
  test('☠ une troncature est ANNONCÉE, avec la taille réelle', () => {
    // Un contenu coupé en silence se lit comme un contenu complet : c'est ainsi
    // qu'on conclut « le fichier s'arrête là » sur une limite d'affichage.
    const long = 'x'.repeat(MAX_RESULTAT + 500);
    const [r] = resultatsDe(utilisateur([{ type: 'tool_result', tool_use_id: 'a', content: long }]));
    expect(r?.contenu).toContain('tronqué');
    expect(r?.contenu).toContain(String(MAX_RESULTAT + 500));
  });

  test('un contenu court n’est jamais marqué', () => {
    expect(borner('court', 100)).toBe('court');
  });
});
