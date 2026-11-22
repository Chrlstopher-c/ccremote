// Responsabilité : l'aiguillage des commandes d'une session tenue ailleurs (Claude Desktop, terminal ordinaire)
// vers sa session Remote Control jumelle (`cse_…`), la seule qui peut recevoir un envoi ou une interruption.
// Logique pure : le registre et le poste sont branchés par l'appelant.
import type { ResumeSession } from '../../commun/session.ts';

export const TEXTE_REFUS_SANS_JUMELLE =
  "Ouverte dans Claude Desktop sans Remote Control : activez-le là-bas, ou fermez-la pour l'ouvrir ici";

// Commandes qui n'ont d'effet que dans le moteur qui tient la conversation : la jumelle les fait, pas le poste.
const COMMANDES_AIGUILLEES: ReadonlySet<string> = new Set(['envoyer', 'interrompre', 'modele']);

export type Aiguillage = { kind: 'directe' } | { kind: 'jumelle'; session: ResumeSession } | { kind: 'refus' };

/**
 * Fiche `cse_` vivante de la conversation de `fiche` (`claudeSessionId`, ou son id). Une jumelle fermée ou déconnectée
 * (Remote Control coupé, Desktop relancé) ne compte pas : un envoi vers elle échouait en « session inconnue ».
 */
export function jumelleRemoteControl(fiche: ResumeSession, fiches: readonly ResumeSession[]): ResumeSession | null {
  const conversation = fiche.claudeSessionId ?? fiche.id;
  return (
    fiches.find(
      (c) =>
        c.id !== fiche.id &&
        c.id.startsWith('cse_') &&
        c.distant?.conversation === conversation &&
        c.distant.connexion !== 'deconnectee' &&
        c.statut !== 'fermee',
    ) ?? null
  );
}

/** Où part la commande `kind` visant `fiche` : au poste directement, vers sa jumelle, ou refusée faute de jumelle. */
export function aiguillage(fiche: ResumeSession, kind: string, fiches: readonly ResumeSession[]): Aiguillage {
  if (fiche.terminal !== true || !COMMANDES_AIGUILLEES.has(kind)) return { kind: 'directe' };
  const jumelle = jumelleRemoteControl(fiche, fiches);
  return jumelle ? { kind: 'jumelle', session: jumelle } : { kind: 'refus' };
}
