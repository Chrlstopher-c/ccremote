/**
 * Responsabilité : pilotage LOCAL des services systemd du Raspberry Pi —
 * lecture d'état (`etat_service`) et redémarrage (`piloter_service`), tous deux
 * HORS canal D.3 (H-75, même logique que `reveil-wol.ts`) : le Pi héberge
 * lui-même les unités visées, il n'y a rien à traverser pour les atteindre.
 *
 * `☠ JAMAIS DE SHELL INTERPOLÉ.` Chaque appel passe par `execFile` (jamais
 * `exec`) : le nom du service circule en ARGUMENT DE TABLEAU, jamais concaténé
 * dans une chaîne de commande — ce qui empêche structurellement une injection
 * shell même si la liste blanche de `outils-service.ts` était contournée en
 * amont. `execFile` ne consulte jamais `/bin/sh`.
 *
 * `☠ OBSTACLE SUDO — ÉTABLI FACTUELLEMENT, PAS SUPPOSÉ.`
 *   - `systemctl is-active` / `systemctl show` sont des LECTURES : systemd/
 *     polkit les autorisent à tout utilisateur local, sans configuration
 *     supplémentaire. `etat_service` fonctionne donc dès le déploiement.
 *   - `systemctl restart <unité-système>` invoque l'action polkit
 *     `org.freedesktop.systemd1.manage-units`. Sur Raspberry Pi OS / Debian,
 *     la règle polkit par défaut exige une authentification admin pour un
 *     utilisateur non-root — `ccremote-harness` tourne en `User=pi`
 *     (`composition/deploiement/ccremote-harness.service`), sans TTY (lancé
 *     par systemd), donc `sudo` SANS `-n` bloquerait indéfiniment sur un
 *     prompt de mot de passe qui n'arrivera jamais : c'est pourquoi
 *     `redemarrerService` appelle `sudo -n …`, qui échoue IMMÉDIATEMENT
 *     (`a password is required`) au lieu de suspendre le process.
 *   - Aucune règle sudoers pour `pi` n'existe dans ce dépôt ni ses scripts de
 *     déploiement (`deploy-harness-pi.sh`, `*.service`) — vérifié par grep au
 *     dépôt de cette mission. `piloter_service` échouera donc SYSTÉMATIQUEMENT
 *     tant que l'opérateur n'a pas ajouté, sur le Pi, en root :
 *
 *       # /etc/sudoers.d/ccremote-piloter-service
 *       pi ALL=(root) NOPASSWD: /usr/bin/systemctl restart portfolio.service
 *       pi ALL=(root) NOPASSWD: /usr/bin/systemctl restart nullnode-relay.service
 *
 *     (chemin `systemctl` à confirmer sur le Pi — `/usr/bin/systemctl` est le
 *     chemin standard Debian/Raspberry Pi OS ; `which systemctl` le vérifie).
 *     UNE RÈGLE PAR UNITÉ DU SEAU 3, jamais un glob (`systemctl restart *`) :
 *     un glob romprait le modèle capacitaire en autorisant `pi` à redémarrer
 *     n'importe quelle unité par sudo, y compris celles du seau 1.
 *
 *   Ce module NE POSE JAMAIS cette règle lui-même (aucune écriture système) —
 *   il détecte l'échec de permission et le NOMME dans `ResultatPilotageService`,
 *   que `outils-service.ts` traduit en `refuse` explicite pour le modèle.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compositionLogger } from '../logger.ts';
import type { EtatServiceSysteme, ResultatPilotageService } from '../../control-plane/orchestrateur/mcp-controle/types.ts';

const execFileAsync = promisify(execFile);
const log = compositionLogger.child({ composant: 'service-systeme' });

/** Au-delà, on abandonne plutôt que d'attendre indéfiniment un systemd muet. */
const DELAI_MS = 5_000;

const ETATS_CONNUS = ['active', 'inactive', 'failed', 'activating', 'deactivating'] as const;
type EtatConnu = (typeof ETATS_CONNUS)[number];

function normaliserEtat(brut: string): EtatServiceSysteme['actif'] {
  return (ETATS_CONNUS as readonly string[]).includes(brut) ? (brut as EtatConnu) : 'autre';
}

/** `systemctl show` rend des lignes `Clef=Valeur` — parsées sans dépendance externe. */
function parserProprietes(sortie: string): Map<string, string> {
  const proprietes = new Map<string, string>();
  for (const ligne of sortie.split('\n')) {
    const i = ligne.indexOf('=');
    if (i === -1) continue;
    proprietes.set(ligne.slice(0, i), ligne.slice(i + 1));
  }
  return proprietes;
}

/** `execFile` rejette sur code de sortie non nul, mais `stdout`/`stderr` restent lisibles sur l'erreur. */
function sortiePartielle(erreur: unknown): { stdout: string; stderr: string } {
  const e = erreur as { stdout?: string; stderr?: string };
  return { stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
}

/**
 * `etat_service` : `is-active` (lecture rapide) puis `show` pour `LoadState`
 * (seul signal fiable d'une unité INCONNUE — `is-active` seul rend `inactive`
 * aussi bien pour un service arrêté que pour un service qui n'a jamais
 * existé) et l'horodatage du dernier changement d'état.
 */
export async function lireEtatService(service: string): Promise<EtatServiceSysteme | null> {
  const etatBrut = await execFileAsync('systemctl', ['is-active', service], { timeout: DELAI_MS })
    .then((r) => r.stdout.trim())
    .catch((erreur: unknown) => sortiePartielle(erreur).stdout.trim());

  const sortieShow = await execFileAsync(
    'systemctl',
    ['show', service, '--property=LoadState,ActiveState,SubState,ActiveEnterTimestamp'],
    { timeout: DELAI_MS },
  ).then((r) => r.stdout);
  const proprietes = parserProprietes(sortieShow);

  if (proprietes.get('LoadState') === 'not-found') return null;

  const sousEtat = proprietes.get('SubState');
  const depuis = proprietes.get('ActiveEnterTimestamp');
  return {
    service,
    actif: normaliserEtat(proprietes.get('ActiveState') ?? etatBrut),
    sousEtat: sousEtat === undefined || sousEtat === '' ? null : sousEtat,
    depuis: depuis === undefined || depuis === '' ? null : depuis,
  };
}

/**
 * Catégorise l'échec d'un `sudo -n systemctl restart` en un motif actionnable.
 * Pure — testable sans exécuter aucune commande (voir `service-systeme.test.ts`).
 */
export function interpreterEchecRedemarrage(service: string, erreur: unknown): ResultatPilotageService {
  const { stdout, stderr } = sortiePartielle(erreur);
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  const texte = `${stdout} ${stderr} ${message}`.toLowerCase();

  if (
    texte.includes('password is required') || // sudo -n : refus non interactif immédiat
    texte.includes('interactive authentication required') || // polkit, hors sudo
    texte.includes('not in the sudoers file') ||
    texte.includes('not allowed to execute')
  ) {
    log.warn({ service }, 'redémarrage refusé — règle sudoers NOPASSWD manquante pour pi');
    return {
      ok: false,
      motif: 'permission',
      detail:
        `privilège root requis, aucune règle sudoers ne l'autorise pour l'utilisateur pi. À ajouter, sur le Pi, ` +
        `en root, dans /etc/sudoers.d/ccremote-piloter-service : « pi ALL=(root) NOPASSWD: /usr/bin/systemctl ` +
        `restart ${service} » — geste de l'opérateur, jamais automatisé par ce harness`,
    };
  }
  if (
    texte.includes('not found') ||
    texte.includes('not-found') ||
    texte.includes('could not be found') ||
    texte.includes('no such file')
  ) {
    return { ok: false, motif: 'inconnu', detail: `unité « ${service} » introuvable` };
  }
  log.error({ service, err: erreur }, 'redémarrage en échec, cause non catégorisée');
  return { ok: false, motif: 'autre', detail: stderr.trim() !== '' ? stderr.trim() : message };
}

/**
 * `piloter_service` (`restart` seul, voir `outils-service.ts`). `-n` sur
 * `sudo` est OBLIGATOIRE : sans lui, un `sudo` interactif suspendrait ce
 * process indéfiniment sur un prompt de mot de passe qu'aucun TTY ne peut
 * jamais fournir (lancé par systemd) — un `sudo` qui bloque est pire qu'un
 * `sudo` qui refuse, il rendrait l'appel MCP muet plutôt qu'en échec constaté.
 */
export async function redemarrerService(service: string): Promise<ResultatPilotageService> {
  try {
    await execFileAsync('sudo', ['-n', 'systemctl', 'restart', service], { timeout: DELAI_MS });
    log.info({ service }, 'service redémarré');
    return { ok: true };
  } catch (erreur) {
    return interpreterEchecRedemarrage(service, erreur);
  }
}
