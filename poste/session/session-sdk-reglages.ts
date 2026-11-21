// Responsabilité : les réglages d'une session SDK en cours — modèle, effort, style, mode rapide et Ultracode —
// appliqués à la requête vivante s'il y en a une, sinon au prochain démarrage ; compatibilité des modes relevée et nom
// du modèle lu.
import { nomAffiche } from './modele-affiche.ts';
import { rapideLu, ultracodeDefaut, ultracodeLu } from './modes-sdk.ts';
import { appliquerReglage, basculerMode, champsReglage, lireModes, type ReglageMode } from './reglages-sdk.ts';
import type { Reglage } from './session-poste.ts';
import type { RequeteSdk } from './session-sdk.ts';
import { maj, type NoyauSdk } from './session-sdk-noyau.ts';

export async function reglerSession(n: NoyauSdk, r: Reglage): Promise<string | null> {
  if (r.kind === 'rapide' || r.kind === 'ultracode') return reglerMode(n, r);
  const requete = n.requete;
  if (requete && r.kind !== 'renommer') {
    try {
      await appliquerReglage(requete, r, n.etat.ultracode?.demande === true);
    } catch (erreur) {
      n.env.journal.warn({ err: erreur, session: n.etat.id, reglage: r.kind }, 'réglage refusé par le SDK');
      return `réglage impossible : ${String(erreur)}`;
    }
  }
  maj(n, r.kind === 'modele' ? { ...champsReglage(r), modeleLe: new Date().toISOString() } : champsReglage(r));
  if (requete && r.kind === 'modele') {
    void nommerModele(n, requete);
    void relever(n, requete);
  }
  return null;
}

// Mode rapide et Ultracode : la requête vivante reçoit la bascule, la fiche reçoit ce que le SDK en fait.
async function reglerMode(n: NoyauSdk, r: ReglageMode): Promise<string | null> {
  try {
    maj(n, await basculerMode(n.requete, r, n.etat, n.env.journal));
    return null;
  } catch (erreur) {
    n.env.journal.warn({ err: erreur, session: n.etat.id, reglage: r.kind }, 'réglage refusé par le SDK');
    return `réglage impossible : ${String(erreur)}`;
  }
}

// Compatibilité du mode rapide et dispo d'Ultracode : relevées à l'initialisation, puis après un modèle.
export async function relever(n: NoyauSdk, requete: RequeteSdk): Promise<void> {
  const lu = await lireModes(requete, n.etat.modele, n.env.journal, n.etat.id);
  if (n.requete !== requete) return;
  maj(n, {
    rapide: rapideLu(n.etat.rapide, lu.rapide, lu.compatible),
    ultracode: ultracodeLu(n.etat.ultracode ?? ultracodeDefaut(), lu.reglages),
  });
}

// Nom affiché du modèle, lu dans la liste du SDK pour le compte ; absent de la liste : pas de nom (Lanterne dérive).
export async function nommerModele(n: NoyauSdk, requete: RequeteSdk): Promise<void> {
  try {
    const init = await requete.initializationResult();
    const nom = nomAffiche(n.etat.modele, init.models);
    if (nom !== (n.etat.modeleNom ?? null)) maj(n, { modeleNom: nom });
  } catch (erreur) {
    n.env.journal.warn({ err: erreur, session: n.etat.id }, 'nom du modèle non lu dans la requête');
  }
}
