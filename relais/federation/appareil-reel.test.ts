// Responsabilité : un appareil client (genre « appareil ») relié à un nœud par l'aiguilleur réel. Appairage
// accepté au nœud, canal chiffré, API clients servie dans le canal ; identité inconnue refusée ; révocation coupe
// le canal. Le relais ne voit que des trames chiffrées (charges observées au nœud = ce que l'aiguilleur transporte).
import { expect, test } from 'bun:test';
import { exporterIdentitePublique, genererIdentite } from '../../commun/chiffrement/identite.ts';
import { attendre, monterAiguilleur } from './banc-federation.ts';
import { appairerAppareil, appareilAvecCode, MAJ, nouveauNoeud } from './banc-appareil.ts';

/** Seuls ces types de message (en clair) peuvent transiter : toute API est dans des trames `chiffre`. */
const CLAIR_AUTORISE = /^(presentation|accord|refus|poignee|poignee-reponse|chiffre|fermer)$/;

test('un appareil accepté au nœud reçoit l’API clients dans son canal chiffré', async () => {
  const monte = monterAiguilleur();
  const { noeud, id } = await nouveauNoeud(monte);
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    expect(await appareil.appeler(canal, '/api/etat')).toEqual({
      statut: 200,
      corps: JSON.stringify({ machine: 'tour' }),
    });
    expect((await appareil.appeler(canal, '/api/federation/aiguilleur')).statut).toBe(403);
    for (const charge of noeud.charges) {
      const message: unknown = JSON.parse(charge);
      expect(message).toMatchObject({ t: expect.stringMatching(CLAIR_AUTORISE) });
    }
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});

test('une identité non acceptée au nœud ne peut pas ouvrir de canal', async () => {
  const monte = monterAiguilleur();
  const { noeud, id } = await nouveauNoeud(monte);
  const intrus = await appareilAvecCode(monte);
  try {
    const inconnue = exporterIdentitePublique((await genererIdentite()).publique);
    intrus.pairs = [{ id, nom: 'tour', identite: inconnue, creeLe: MAJ, genre: 'noeud' }];
    const canal = intrus.ouvrir('lien-1', id, 'lien');
    await attendre(() => intrus.refusees.length > 0);
    expect(intrus.ouverts).not.toContain('lien-1');
    expect(await intrus.appeler(canal, '/api/etat')).toEqual({ statut: 0, corps: '' });
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});

test('révoquer un appareil coupe son canal et refuse tout nouveau lien', async () => {
  const monte = monterAiguilleur();
  const { noeud, id } = await nouveauNoeud(monte);
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    expect((await noeud.federation.revoquer(appareil.membre)).ok).toBe(true);
    await attendre(() => appareil.fermes.includes('ap-1'));
    expect(await appareil.appeler(canal, '/api/etat')).toEqual({ statut: 0, corps: '' });
    appareil.ouvrir('lien-2', id, 'lien');
    await attendre(() => appareil.refusees.length > 0);
    expect(appareil.ouverts).toEqual(['ap-1']);
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});
