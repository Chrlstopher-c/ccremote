// Responsabilité : extraire le code du poste (cc, tmux.conf) de l'archive embarquée, car le binaire compilé n'a pas
// ces fichiers sur disque et tmux comme `cc` doivent les lire.
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface CodePoste {
  readonly cc: string;
  readonly tmuxConf: string;
}

export async function extraireCodePoste(archive: string | undefined, dossier: string): Promise<CodePoste | null> {
  if (!archive || !existsSync(archive)) return null;
  rmSync(dossier, { recursive: true, force: true });
  mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const processus = Bun.spawn(['tar', '-xzf', archive, '-C', dossier], { stdout: 'ignore', stderr: 'pipe' });
  const code = await processus.exited;
  if (code !== 0) {
    const detail = await new Response(processus.stderr).text();
    throw new Error(`extraction du code du poste impossible (tar ${code}) : ${detail.trim()}`);
  }
  const session = join(dossier, 'poste/session');
  chmodSync(join(session, 'cc'), 0o755);
  return { cc: join(session, 'cc'), tmuxConf: join(session, 'tmux.conf') };
}
