// Responsabilité : installer le poste sur une machine SSH — archive du code et des fichiers de configuration, puis script
// distant (bun install, configuration 600, unité systemd utilisateur). Le secret ne sort jamais sur la ligne de
// commande : il voyage dans l'archive, dans un dossier temporaire 700 supprimé à la fin.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnexionSsh, Ssh } from './ssh.ts';
import { type Nommage, NOMMAGE_QUART, scriptInstallation } from './script-installation.ts';

export { UNITE_POSTE, scriptInstallation } from './script-installation.ts';

/** Fichiers du code envoyés tels quels (le poste et ses dépendances de production). */
export const ELEMENTS_CODE = ['poste', 'commun', 'package.json', 'bun.lock'] as const;

export interface FichiersPoste {
  readonly posteJson: string;
  readonly posteEnv: string;
}

export interface Extras {
  readonly donnees?: string; // dossier des données du poste (Lanterne : son propre dossier)
  readonly empreinte?: string; // empreinte du code embarqué, annoncée par le poste à sa connexion
}

/** La config du poste : sans secret (il est dans poste.env). */
export function fichiersPoste(
  id: string,
  description: string,
  relais: string,
  secret: string,
  api?: { readonly url: string; readonly jeton: string },
  extras: Extras = {},
): FichiersPoste {
  const config = {
    machine: id,
    relais,
    description: description || id,
    racines: ['~'],
    comptes: { principal: null },
    donnees: extras.donnees ?? '~/.local/share/quart-poste/donnees',
  };
  const empreinte = extras.empreinte ? `CCREMOTE_EMPREINTE_CODE=${extras.empreinte}\n` : '';
  const jetonApi = api ? `CCREMOTE_URL_API=${api.url}\nCCREMOTE_JETON_API=${api.jeton}\n` : '';
  return {
    posteJson: `${JSON.stringify(config, null, 2)}\n`,
    posteEnv: `CCREMOTE_SECRET_POSTE=${secret}\n${jetonApi}${empreinte}`,
  };
}

/** Dossier temporaire 700 contenant install/ (script, config, secret) ; à supprimer par l'appelant. */
export async function preparerDossier(
  id: string,
  fichiers: FichiersPoste,
  nommage: Nommage = NOMMAGE_QUART,
): Promise<string> {
  const racine = await mkdtemp(join(tmpdir(), 'quart-installation-'));
  const install = join(racine, 'install');
  await mkdir(install, { mode: 0o700 });
  await writeFile(join(install, 'installer.sh'), scriptInstallation(id, nommage), { mode: 0o700 });
  await writeFile(join(install, 'poste.json'), fichiers.posteJson, { mode: 0o600 });
  await writeFile(join(install, 'poste.env'), fichiers.posteEnv, { mode: 0o600 });
  return racine;
}

/** Archive tar.gz : le code du poste à la racine de l'archive, puis install/ (script et configuration). */
export async function archiver(racineCode: string, dossierInstall: string): Promise<Uint8Array> {
  const processus = Bun.spawn(
    ['tar', '-czf', '-', '-C', racineCode, ...ELEMENTS_CODE, '-C', dossierInstall, 'install'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [octets, erreurs, code] = await Promise.all([
    new Response(processus.stdout).arrayBuffer(),
    new Response(processus.stderr).text(),
    processus.exited,
  ]);
  if (code !== 0) throw new Error(`tar a échoué : ${erreurs.trim()}`);
  return new Uint8Array(octets);
}

/**
 * Empreinte du code du poste : sha256 d'une archive tar déterministe (ordre des noms, dates et propriétaires fixés),
 * donc identique pour deux copies du même code, quelle que soit leur date de copie.
 */
export async function empreinteCode(racineCode: string): Promise<string> {
  const processus = Bun.spawn(
    [
      'tar', '-cf', '-', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
      '-C', racineCode, ...ELEMENTS_CODE,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [octets, erreurs, code] = await Promise.all([
    new Response(processus.stdout).arrayBuffer(),
    new Response(processus.stderr).text(),
    processus.exited,
  ]);
  if (code !== 0) throw new Error(`empreinte du code : tar a échoué : ${erreurs.trim()}`);
  return createHash('sha256').update(new Uint8Array(octets)).digest('hex');
}

/** Extrait une archive de code (variable LANTERNE_MOTEUR_CODE_POSTE) dans un dossier vide ; rend sa racine. */
export async function extraireCodePoste(fichier: string, dossier: string): Promise<string> {
  const processus = Bun.spawn(['tar', '-xzf', fichier, '-C', dossier], { stdout: 'ignore', stderr: 'pipe' });
  const [erreurs, code] = await Promise.all([new Response(processus.stderr).text(), processus.exited]);
  if (code !== 0) throw new Error(`extraction du code du poste : tar a échoué : ${erreurs.trim()}`);
  return dossier;
}

export function commandeInstallation(): string {
  return `t=$(mktemp -d) && tar -xzf - -C "$t" && bash "$t/install/installer.sh"; c=$?; rm -rf "$t"; exit $c`;
}

export interface ResultatInstallation {
  readonly ok: boolean;
  readonly sortie: string;
}

export async function installerPoste(
  ssh: Ssh,
  c: ConnexionSsh,
  archive: Uint8Array,
  surLigne?: (ligne: string) => void,
): Promise<ResultatInstallation> {
  const r = await ssh.executer(c, commandeInstallation(), archive, 900_000, surLigne);
  const fin = `${r.sortie}${r.erreurs}`.trim().split('\n').slice(-30).join('\n');
  return { ok: r.code === 0, sortie: fin };
}
