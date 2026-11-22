// Responsabilité : les commandes envoyées par SSH pour ajouter un nœud — dépôt du binaire et du code des postes (rangés
// sous l'empreinte du binaire), puis le script d'installation (`noeud-distant.sh`) précédé de ses paramètres cités.
// Les commandes sont fixes : aucune valeur venue de l'API n'y entre sans être validée puis citée. Le code d'appairage
// voyage sur l'entrée standard (jamais sur une ligne de commande visible dans `ps`).
import { ID_MACHINE_AJOUT, NOM_AJOUT } from '../../commun/ajout-noeud.ts';
import { citer } from '../machines/modele.ts';
import corps from './noeud-distant.sh' with { type: 'text' };

export const DOSSIER_NOEUD = '.local/share/lanterne-noeud';
const SHA = /^[a-f0-9]{12}$/;
const MEMBRE = /^[a-f0-9]{12}$/;
const CODE = /^[A-Za-z0-9-]{4,40}$/;
const URL_AIGUILLEUR = /^https?:\/\/[A-Za-z0-9.:[\]-]+$/;

export interface ParametresNoeud {
  readonly sha: string;
  readonly machine: string;
  readonly nom: string;
  /** Origine de l'aiguilleur vue de la machine (http(s)://hôte:port). */
  readonly aiguilleur: string;
  /** Code à usage unique ; null si le nœud est déjà relié (relance). */
  readonly code: string | null;
  /** Le nœud qui ajoute la machine : le nouveau nœud lui demande l'appairage. */
  readonly pair: string;
}

/** Reçoit le binaire compressé (gzip) sur l'entrée standard, le range sous son empreinte, l'annonce (« @sha … »). */
export function commandeDepotBinaire(): string {
  return [
    'set -eu',
    `B="$HOME/${DOSSIER_NOEUD}"`,
    'mkdir -p "$B/tmp" "$B/versions" && chmod 700 "$B"',
    't="$B/tmp/binaire.$$"',
    'gzip -dc > "$t"',
    's="$(sha256sum "$t" | cut -c1-12)"',
    'mkdir -p "$B/versions/$s"',
    'mv -f "$t" "$B/versions/$s/lanterne-moteur"',
    'chmod 755 "$B/versions/$s/lanterne-moteur"',
    'echo "@sha $s"',
  ].join('\n');
}

/** Reçoit l'archive du code des postes sur l'entrée standard, à côté du binaire d'empreinte `sha`. */
export function commandeDepotCode(sha: string): string {
  if (!SHA.test(sha)) throw new Error('empreinte de binaire invalide');
  return `set -eu; cat > "$HOME/${DOSSIER_NOEUD}/versions/${sha}/poste-code.tgz"`;
}

/** Vrai si le nœud de la machine a déjà rejoint un aiguilleur (pas de code à créer pour lui). */
export function commandeSonde(): string {
  return `test -f "$HOME/${DOSSIER_NOEUD}/donnees/secrets/federation/aiguilleur.json" && echo '@relie' || echo '@neuf'`;
}

export function commandeRetourArriere(): string {
  return `bash "$HOME/${DOSSIER_NOEUD}/retour-arriere.sh"`;
}

/** Le script complet, à passer sur l'entrée standard de `bash -s`. */
export function scriptNoeud(p: ParametresNoeud): string {
  valider(p);
  const entete = [
    `SHA=${citer(p.sha)}`,
    `MACHINE=${citer(p.machine)}`,
    `NOM_NOEUD=${citer(p.nom)}`,
    `AIGUILLEUR=${citer(p.aiguilleur)}`,
    `CODE=${citer(p.code ?? '')}`,
    `PAIR=${citer(p.pair)}`,
  ].join('\n');
  return `#!/usr/bin/env bash\n${entete}\n${corps}`;
}

function valider(p: ParametresNoeud): void {
  if (!SHA.test(p.sha)) throw new Error('empreinte de binaire invalide');
  if (!ID_MACHINE_AJOUT.test(p.machine)) throw new Error('identifiant de machine invalide');
  if (!NOM_AJOUT.test(p.nom)) throw new Error('nom invalide');
  if (!URL_AIGUILLEUR.test(p.aiguilleur)) throw new Error('adresse de l’aiguilleur invalide');
  if (p.code !== null && !CODE.test(p.code)) throw new Error('code invalide');
  if (!MEMBRE.test(p.pair)) throw new Error('identifiant du nœud demandeur invalide');
}
