// Responsabilité : les lectures du panneau d'une session SDK — usage du compte, contexte, connecteurs MCP, styles de
// sortie, tâches de fond. Lectures seules sur la requête vivante ; au repos, le dernier relevé gardé dans la fiche.
import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import type { StylesSession } from '../../commun/configuration.ts';
import type { ConnecteurSession, ContexteSession, DetailTacheSession, TacheSession } from '../../commun/panneau.ts';
import { contexteDe } from './contexte-sdk.ts';
import type { EtatMcp } from './file-messages-sdk.ts';
import type { RequeteSdk } from './session-sdk.ts';
import { maj, type NoyauSdk } from './session-sdk-noyau.ts';

// Usage du compte (abonnement, contributeurs) : lecture seule ; sans requête ouverte, null.
export async function usageSdk(n: NoyauSdk): Promise<SDKControlGetUsageResponse | null> {
  const requete = n.requete;
  if (!requete) return null;
  try {
    return await requete.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
  } catch (erreur) {
    n.env.journal.warn({ err: erreur, session: n.etat.id }, 'usage du compte non lu dans la requête');
    return null;
  }
}

// Le contexte n'existe que pendant une requête ouverte (null sinon).
export async function contexte(n: NoyauSdk): Promise<ContexteSession | null> {
  const requete = n.requete;
  if (!requete) return null;
  return contexteDe(await requete.getContextUsage({ detail: 'summary' }));
}

export async function connecteurs(n: NoyauSdk): Promise<ConnecteurSession[]> {
  const requete = n.requete;
  if (!requete) return n.etat.connecteurs ?? [];
  return releverConnecteurs(n, requete);
}

// Connecteurs MCP : réglés dans la requête vivante (voir session-sdk-vivante.ts).
export async function basculerConnecteur(n: NoyauSdk, nom: string, actif: boolean): Promise<string | null> {
  const requete = n.requete;
  const erreur = await n.reglagesVivants.connecteur(nom, actif);
  if (erreur) return erreur;
  // Retenu dans la fiche : réappliqué au prochain démarrage du processus (reprise après sommeil, redémarrage).
  const coupes = new Set(n.etat.connecteursCoupes ?? []);
  if (actif) coupes.delete(nom);
  else coupes.add(nom);
  maj(n, { connecteursCoupes: [...coupes] });
  if (requete) void releverConnecteurs(n, requete);
  return null;
}

export async function releverConnecteurs(n: NoyauSdk, requete: RequeteSdk): Promise<ConnecteurSession[]> {
  try {
    memoriserEtats(n, requete, await requete.mcpServerStatus());
  } catch (erreur) {
    n.env.journal.warn({ err: erreur, session: n.etat.id }, 'connecteurs MCP non relevés');
  }
  return n.etat.connecteurs ?? [];
}

export function memoriserEtats(n: NoyauSdk, requete: RequeteSdk, etats: readonly EtatMcp[]): void {
  if (n.requete !== requete) return;
  const liste = etats.map((etat) => ({
    nom: etat.name,
    statut: n.reglagesVivants.statut(etat.name, etat.status),
  }));
  if (JSON.stringify(liste) !== JSON.stringify(n.etat.connecteurs ?? [])) maj(n, { connecteurs: liste });
}

// `initializationResult` garde le style du lancement : un style changé en cours de session vient de la fiche.
export async function stylesVivants(n: NoyauSdk): Promise<StylesSession | null> {
  const lus = await n.reglagesVivants.styles();
  return lus && n.etat.style_sortie ? { ...lus, actuel: n.etat.style_sortie } : lus;
}

export function rechargerStyles(n: NoyauSdk): Promise<void> {
  return n.reglagesVivants.recharger();
}

export function taches(n: NoyauSdk): TacheSession[] {
  return n.registreTaches.liste();
}

export function tache(n: NoyauSdk, id: string): DetailTacheSession | null {
  return n.registreTaches.detail(id);
}
