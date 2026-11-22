// Responsabilité : la vue de l'état de la fédération (`GET /api/federation`), assemblée depuis le nœud et ses
// modules.
import { empreinteIdentite } from '../../commun/chiffrement/identite.ts';
import { appairagesEnCours, noeudAppaire } from './appairages.ts';
import type { DemandesAppairage } from './demandes.ts';
import type { EtatFederation } from './etat-federation.ts';
import type { LiensNoeud } from './liens-noeud.ts';
import type { PortNoeud } from './noeud-port.ts';

/** L'état courant de la fédération : aiguilleur, pairs, demandes, appairages en cours, liaisons directes. */
export async function etatFederation(
  port: PortNoeud,
  liens: LiensNoeud,
  demandes: DemandesAppairage,
): Promise<EtatFederation> {
  const identite = await port.identite();
  const lien = (id: string): boolean => port.canaux.liaisonOuverteAvec(id) !== null;
  const noeuds = await Promise.all(
    port.pairs()
      .filter((p) => p.genre === 'noeud')
      .map((p) => noeudAppaire(p, port.voisins.enLigne(p.id), lien(p.id))),
  );
  const config = port.config();
  return {
    aiguilleur: config
      ? {
          url: config.url,
          id: config.id,
          nom: config.nom,
          proprietaire: config.proprietaire ?? null,
          relie: liens.lien?.connecte() ?? false,
          motif: liens.motifArret,
        }
      : null,
    empreinteLocale: await empreinteIdentite(identite.publique),
    membres: port.voisins.liste(port.proprietaireLocal()),
    noeuds,
    demandes: demandes.lister(),
    appairages: await appairagesEnCours(port.canaux.actifs()),
    directe: liens.directs.etat(),
    liaisons: liens.directs.liaisons(),
  };
}
