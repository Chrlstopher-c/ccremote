import { describe, expect, test } from 'bun:test';
import type { Evenement } from '../../commun/session.ts';
import { attendre, journal, persistee } from './faux-sdk.ts';
import { requeteFactice } from './requete-factice.ts';
import { sdkFacticeDemande } from '../config.ts';
import { type EnvironnementSdk, SessionSdk } from './session-sdk.ts';

const REPONSE = (texte: string): string => `Réponse factice à : « ${texte} »`;

function tours(evenements: readonly Evenement[]): number {
  return evenements.filter((e) => e.type === 'tour_fini').length;
}

function lancerAvecMoteurFactice(): { session: SessionSdk; evenements: Evenement[] } {
  const evenements: Evenement[] = [];
  const moteur = requeteFactice(true, journal);
  const env: EnvironnementSdk = {
    journal,
    sortie: { evenement: (_id, evt) => void evenements.push(evt), resume: () => undefined },
    executable: null,
    socket: '/run/poste.sock',
    delaiMcpMs: 200,
    periodeMcpMs: 1,
    ...moteur,
  };
  return { session: new SessionSdk(persistee(null), env), evenements };
}

describe('moteur de session factice', () => {
  test('sans LANTERNE_SDK_FACTICE=1, l’environnement ne porte aucune fabrique : le vrai SDK reste', () => {
    expect('requete' in requeteFactice(false, journal)).toBe(false);
    expect(sdkFacticeDemande({})).toBe(false);
    expect(sdkFacticeDemande({ LANTERNE_SDK_FACTICE: '0' })).toBe(false);
    expect(sdkFacticeDemande({ LANTERNE_SDK_FACTICE: '1' })).toBe(true);
  });

  test(
    'bonjour puis outil : fil complet (diffusion, final, outil, résultat, fin de tour) sans réseau',
    async () => {
      const { session, evenements } = lancerAvecMoteurFactice();
      expect(await session.lancer('bonjour')).toBeNull();
      await attendre(() => tours(evenements) === 1, 10_000);
      expect(await session.envoyer('outil')).toBeNull();
      await attendre(() => tours(evenements) === 2, 10_000);
      await session.fermer();

      expect(evenements.filter((e) => e.type === 'erreur')).toEqual([]);
      expect(evenements).toContainEqual(expect.objectContaining({ type: 'message', texte: 'bonjour' }));
      expect(evenements).toContainEqual(expect.objectContaining({ type: 'message', texte: 'outil' }));

      const flux = evenements.filter((e) => e.type === 'flux');
      expect(flux.length).toBeGreaterThanOrEqual(10);
      const diffuse = flux.map((e) => (e.type === 'flux' ? e.delta : '')).join('');
      expect(diffuse).toBe(REPONSE('bonjour') + REPONSE('outil'));

      expect(evenements).toContainEqual(expect.objectContaining({ type: 'texte', texte: REPONSE('bonjour') }));
      expect(evenements).toContainEqual(expect.objectContaining({ type: 'texte', texte: REPONSE('outil') }));

      const outil = evenements.find((e) => e.type === 'outil');
      expect(outil).toEqual(expect.objectContaining({ type: 'outil', nom: 'Bash' }));
      const resultat = evenements.find((e) => e.type === 'resultat_outil');
      expect(resultat).toEqual(expect.objectContaining({ type: 'resultat_outil', extrait: 'factice', erreur: false }));
      const indexOutil = evenements.findIndex((e) => e.type === 'outil');
      const indexTexte = evenements.findIndex((e) => e.type === 'texte' && e.texte === REPONSE('outil'));
      expect(indexOutil).toBeLessThan(indexTexte);

      const fins = evenements.filter((e) => e.type === 'tour_fini');
      expect(fins).toHaveLength(2);
    },
    20_000,
  );
});
