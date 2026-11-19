// Responsabilité : les connecteurs MCP de la machine, lus dans `claude mcp list` (délai maximal 60 s, résultat gardé
// 30 s pour ne pas relancer les contrôles de santé à chaque écran).
import type { ConnecteurMachine, EtatConnecteur } from '../../commun/configuration.ts';
import { type LanceurClaude, messageEchec } from './exec.ts';

export const DELAI_CONNECTEURS_MS = 60_000;
export const CACHE_CONNECTEURS_MS = 30_000;

export type ResultatConnecteurs =
  { readonly ok: true; readonly connecteurs: ConnecteurMachine[] } | { readonly ok: false; readonly erreur: string };

/** Une ligne par serveur : `nom: cible - état`. Les lignes sans cette forme (en-tête, attente) sont ignorées. */
export function analyserConnecteurs(sortie: string): ConnecteurMachine[] {
  return sortie.split('\n').flatMap((ligne) => {
    const sep = ligne.indexOf(': ');
    const fin = ligne.lastIndexOf(' - ');
    if (sep <= 0 || fin <= sep) return [];
    const nom = ligne.slice(0, sep).trim();
    const cible = ligne.slice(sep + 2, fin).trim();
    return [{ nom, cible, etat: etatDe(ligne.slice(fin + 3)) }];
  });
}

function etatDe(statut: string): EtatConnecteur {
  if (/failed/i.test(statut)) return 'echec';
  if (/needs authentication/i.test(statut)) return 'authentification';
  if (/connected/i.test(statut)) return 'connecte';
  return 'inconnu';
}

export function creerListeurConnecteurs(p: { readonly lancer: LanceurClaude; readonly maintenant?: () => number }) {
  let cache: { readonly quand: number; readonly valeur: ConnecteurMachine[] } | null = null;
  return {
    async lister(): Promise<ResultatConnecteurs> {
      const t = p.maintenant?.() ?? Date.now();
      if (cache && t - cache.quand < CACHE_CONNECTEURS_MS) return { ok: true, connecteurs: cache.valeur };
      const r = await p.lancer(['mcp', 'list']);
      if (r.delaiDepasse) return { ok: false, erreur: 'délai dépassé' };
      if (r.code !== 0 && r.sortie.trim() === '') return { ok: false, erreur: messageEchec(r) };
      const connecteurs = analyserConnecteurs(r.sortie);
      cache = { quand: t, valeur: connecteurs };
      return { ok: true, connecteurs };
    },
  };
}

export type ListeurConnecteurs = ReturnType<typeof creerListeurConnecteurs>;
