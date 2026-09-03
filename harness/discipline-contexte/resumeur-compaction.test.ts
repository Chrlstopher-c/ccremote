import { describe, expect, test } from 'bun:test'
import {
  creerHookPostCompactResume,
  formaterBlocResume,
  fusionnerResumeBorne,
  traiterPostCompact,
} from './resumeur-compaction.ts'

describe('formaterBlocResume — source native, zéro appel LLM', () => {
  test('structure un résumé non vide avec horodatage et déclencheur', () => {
    const bloc = formaterBlocResume('État: build vert. Reste: brancher le bouton.', 'auto', 1_000)
    expect(bloc).toContain('État: build vert. Reste: brancher le bouton.')
    expect(bloc).toContain('déclencheur=auto')
    expect(bloc).toContain(new Date(1_000).toISOString())
  });

  test('rend null sur un résumé vide ou blanc — jamais de bloc vide écrit', () => {
    expect(formaterBlocResume('', 'auto', 1_000)).toBeNull();
    expect(formaterBlocResume('   \n  ', 'manual', 1_000)).toBeNull();
  });
});

describe('fusionnerResumeBorne — append borné, garde les N derniers', () => {
  test('premier résumé sur une team neuve (existant null)', () => {
    const fusion = fusionnerResumeBorne(null, 'bloc-1');
    expect(fusion).toBe('bloc-1');
  });

  test('empile les blocs successifs', () => {
    const apres1 = fusionnerResumeBorne(null, 'bloc-1');
    const apres2 = fusionnerResumeBorne(apres1, 'bloc-2');
    expect(apres2).toContain('bloc-1');
    expect(apres2).toContain('bloc-2');
  });

  test('☠ borne à maxBlocs — ne devient jamais un log infini', () => {
    let resume: string | null = null;
    for (let i = 0; i < 10; i++) resume = fusionnerResumeBorne(resume, `bloc-${i}`, 3);
    expect(resume).not.toBeNull();
    expect(resume).not.toContain('bloc-6');
    expect(resume).toContain('bloc-7');
    expect(resume).toContain('bloc-8');
    expect(resume).toContain('bloc-9');
  });

  test('un resume_contexte écrit par une autre voie (sans marqueur) reste traité comme un bloc unique', () => {
    const fusion = fusionnerResumeBorne('texte libre préexistant', 'bloc-1', 5);
    expect(fusion).toContain('texte libre préexistant');
    expect(fusion).toContain('bloc-1');
  });
});

describe('traiterPostCompact — capture pure, aucun second appel modèle', () => {
  test('appelle onResume avec le bloc formaté quand le résumé natif est présent', () => {
    const recus: string[] = [];
    traiterPostCompact(
      { trigger: 'auto', compact_summary: 'ÉTAT: X. RESTE: Y.' },
      { onResume: (bloc) => recus.push(bloc), horloge: { maintenant: () => 42 } },
    );
    expect(recus).toHaveLength(1);
    expect(recus[0]).toContain('ÉTAT: X. RESTE: Y.');
  });

  test('n’appelle jamais onResume sur un résumé vide', () => {
    const recus: string[] = [];
    traiterPostCompact({ trigger: 'auto', compact_summary: '' }, { onResume: (bloc) => recus.push(bloc) });
    expect(recus).toHaveLength(0);
  });
});

describe('creerHookPostCompactResume — hook SDK actif', () => {
  test('☠ le hook devient ACTIF : capture compact_summary sur PostCompact', async () => {
    const recus: string[] = [];
    const hook = creerHookPostCompactResume({ onResume: (bloc) => recus.push(bloc) });
    const sortie = await hook(
      {
        hook_event_name: 'PostCompact',
        trigger: 'auto',
        compact_summary: 'ÉTAT: build vert.',
      } as never,
      null as never,
      {} as never,
    );
    expect(sortie).toEqual({});
    expect(recus).toHaveLength(1);
    expect(recus[0]).toContain('ÉTAT: build vert.');
  });

  test('ignore tout événement qui n’est pas PostCompact', async () => {
    const recus: string[] = [];
    const hook = creerHookPostCompactResume({ onResume: (bloc) => recus.push(bloc) });
    await hook({ hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: null } as never, null as never, {} as never);
    expect(recus).toHaveLength(0);
  });

  test('ne lève jamais même si onResume lève — signale via surErreur', async () => {
    const erreurs: unknown[] = [];
    const hook = creerHookPostCompactResume({
      onResume: () => {
        throw new Error('panne du sink');
      },
      surErreur: (e) => erreurs.push(e),
    });
    const sortie = await hook(
      { hook_event_name: 'PostCompact', trigger: 'auto', compact_summary: 'X' } as never,
      null as never,
      {} as never,
    );
    expect(sortie).toEqual({});
    expect(erreurs).toHaveLength(1);
  });

  test('☠ AUCUN appel LLM introduit : la fonction ne dépend que de compact_summary et onResume, jamais de query()', () => {
    const source = creerHookPostCompactResume.toString() + traiterPostCompact.toString() + formaterBlocResume.toString();
    expect(source).not.toContain('query(');
    expect(source).not.toContain('.query.');
  });
});
