// Responsabilité : git dans le dossier d'une session — modifications, diff, annulation, commit. Sans shell (arguments
// séparés), pathspecs littéraux, chemins relatifs au dossier. Équivalent de crates/lanterne-poste/src/git.rs.
import { existsSync, realpathSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import type { Logger } from 'pino';
import type { Diff, EtatFichier, Hunk, Modifications, PorteeModifications } from '../../commun/modifications.ts';
import { comptesNumstat, compterLignes, etatsNameStatus, hunkNouveauFichier, hunksUnifies } from './analyse-diff.ts';

// Arbre vide de git : base de comparaison d'un dépôt sans aucun commit.
const ARBRE_VIDE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const BRANCHES_DE_BASE = ['main', 'master'];

export interface ChangementSuivi {
  readonly chemin: string;
  readonly etat: EtatFichier;
  readonly ajouts: number;
  readonly suppressions: number;
  readonly binaire: boolean;
}

interface Resultat {
  readonly code: number;
  readonly sortie: string;
  readonly erreur: string;
}

/** Texte d'un fichier ; `null` si ce n'est pas du texte UTF-8 (binaire, illisible, absent). */
export async function lireTexte(chemin: string, journal: Logger): Promise<string | null> {
  try {
    const octets = new Uint8Array(await readFile(chemin));
    if (octets.includes(0)) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch (erreur) {
    journal.debug({ err: erreur, chemin }, 'fichier non lisible comme texte');
    return null;
  }
}

/** Chemin absolu de `relatif` sous `dossier` ; refuse l'absolu, le `..`, et un lien qui sort du dossier. */
export function resoudreDansDossier(dossier: string, relatif: string): string {
  const sortDuDossier = isAbsolute(relatif) || relatif.split(/[\\/]/).some((segment) => segment === '..');
  if (sortDuDossier) throw new Error(`chemin refusé : ${relatif}`);
  const candidat = join(dossier, relatif);
  if (existsSync(candidat)) {
    const reel = realpathSync(candidat);
    const racine = realpathSync(dossier);
    if (reel !== racine && !reel.startsWith(racine + sep)) throw new Error(`chemin refusé : ${relatif}`);
  }
  return candidat;
}

/** Un dépôt git vu depuis le dossier d'une session. Chaque commande part avec des arguments séparés. */
export class DepotGit {
  constructor(
    private readonly dossier: string,
    private readonly journal: Logger,
  ) {}

  async modifications(portee: PorteeModifications): Promise<Modifications> {
    await this.verifier();
    const base = await this.base(portee);
    return {
      racine: realpathSync(this.dossier),
      branche: await this.brancheCourante(),
      fichiers: await this.changements(base),
    };
  }

  async diff(chemin: string, portee: PorteeModifications): Promise<Diff> {
    await this.verifier();
    resoudreDansDossier(this.dossier, chemin);
    const base = await this.base(portee);
    const changement = (await this.changements(base)).find((c) => c.chemin === chemin);
    const etat: EtatFichier = changement?.etat ?? 'modifie';
    const binaire = changement?.binaire ?? false;
    const suivi = !(await this.nonSuivis()).includes(chemin);
    return { chemin, etat, binaire, hunks: await this.hunks(chemin, base, binaire, suivi) };
  }

  private async hunks(chemin: string, base: string, binaire: boolean, suivi: boolean): Promise<Hunk[]> {
    if (binaire) return [];
    if (suivi) {
      return hunksUnifies(
        await this.reussir(['diff', '--relative', '--no-color', '--no-renames', '-U3', base, '--', chemin]),
      );
    }
    const texte = await lireTexte(join(this.dossier, chemin), this.journal);
    return texte === null ? [] : hunkNouveauFichier(texte);
  }

  /** Retour au dernier commit, ou suppression si le fichier n'est pas suivi. */
  async annuler(chemin: string): Promise<void> {
    await this.verifier();
    const absolu = resoudreDansDossier(this.dossier, chemin);
    if ((await this.nonSuivis()).includes(chemin)) {
      await this.supprimer(absolu);
      return;
    }
    const dansCommit = (await this.lancer(['cat-file', '-e', `HEAD:${chemin}`])).code === 0;
    if (dansCommit) {
      await this.reussir(['restore', '--source=HEAD', '--staged', '--worktree', '--', chemin]);
    } else {
      await this.reussir(['rm', '-f', '--quiet', '--', chemin]);
    }
  }

  /** Ajoute toutes les modifications du dossier et les commite. Renvoie l'empreinte courte du commit. */
  async commiter(message: string): Promise<string> {
    await this.verifier();
    const texte = message.trim();
    if (texte === '') throw new Error('le message de commit est vide');
    await this.reussir(['add', '-A', '--', '.']);
    await this.reussir(['commit', '-m', texte]);
    return (await this.reussir(['rev-parse', '--short', 'HEAD'])).trim();
  }

  async brancheCourante(): Promise<string | null> {
    const r = await this.lancer(['rev-parse', '--abbrev-ref', 'HEAD']);
    const nom = r.sortie.trim();
    return r.code === 0 && nom !== '' && nom !== 'HEAD' ? nom : null;
  }

  private async verifier(): Promise<void> {
    const r = await this.lancer(['rev-parse', '--is-inside-work-tree']);
    if (r.code !== 0 || r.sortie.trim() !== 'true') throw new Error(`hors dépôt git : ${this.dossier}`);
  }

  private async base(portee: PorteeModifications): Promise<string> {
    if (portee === 'non_commitees') {
      const r = await this.lancer(['rev-parse', '--verify', '-q', 'HEAD']);
      return r.code === 0 ? r.sortie.trim() : ARBRE_VIDE;
    }
    for (const branche of BRANCHES_DE_BASE) {
      const r = await this.lancer(['merge-base', 'HEAD', branche]);
      if (r.code === 0) return r.sortie.trim();
    }
    throw new Error("aucune branche de base (main ou master) n'a été trouvée");
  }

  // Fichiers suivis (état et comptes) puis fichiers non suivis, comptés comme des ajouts.
  private async changements(base: string): Promise<ChangementSuivi[]> {
    const etats = etatsNameStatus(
      await this.reussir(['diff', '--relative', '--no-renames', '--name-status', '-z', base, '--', '.']),
    );
    const comptes = comptesNumstat(
      await this.reussir(['diff', '--relative', '--no-renames', '--numstat', '-z', base, '--', '.']),
    );
    const suivis = etats.map(({ etat, chemin }): ChangementSuivi => {
      const compte = comptes.find((c) => c.chemin === chemin);
      return {
        chemin,
        etat,
        ajouts: compte?.ajouts ?? 0,
        suppressions: compte?.suppressions ?? 0,
        binaire: compte?.binaire ?? false,
      };
    });
    const nouveaux = await Promise.all((await this.nonSuivis()).map((chemin) => this.nonSuivi(chemin)));
    return [...suivis, ...nouveaux];
  }

  private async nonSuivi(chemin: string): Promise<ChangementSuivi> {
    const texte = await lireTexte(join(this.dossier, chemin), this.journal);
    return {
      chemin,
      etat: 'ajoute',
      ajouts: texte === null ? 0 : compterLignes(texte),
      suppressions: 0,
      binaire: texte === null,
    };
  }

  private async nonSuivis(): Promise<string[]> {
    const sortie = await this.reussir(['ls-files', '--others', '--exclude-standard', '-z', '--', '.']);
    return sortie.split('\0').filter((chemin) => chemin !== '');
  }

  private async supprimer(absolu: string): Promise<void> {
    try {
      await unlink(absolu);
    } catch (erreur) {
      this.journal.error({ err: erreur, chemin: absolu }, 'suppression impossible');
      throw new Error(`suppression impossible : ${String(erreur)}`);
    }
  }

  // `git -C <dossier> <arguments>` : pathspecs littéraux, jamais de question au terminal.
  private async lancer(args: readonly string[]): Promise<Resultat> {
    try {
      const processus = Bun.spawn(['git', '-C', this.dossier, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, GIT_LITERAL_PATHSPECS: '1', GIT_TERMINAL_PROMPT: '0' },
      });
      const [sortie, erreur, code] = await Promise.all([
        new Response(processus.stdout).text(),
        new Response(processus.stderr).text(),
        processus.exited,
      ]);
      if (code !== 0) this.journal.debug({ args, code }, 'git a répondu en échec');
      return { code, sortie, erreur: erreur.trim() };
    } catch (erreur) {
      this.journal.error({ err: erreur, args }, 'git impossible à lancer');
      throw new Error(`git introuvable : ${String(erreur)}`);
    }
  }

  private async reussir(args: readonly string[]): Promise<string> {
    const r = await this.lancer(args);
    if (r.code !== 0) throw new Error(r.erreur || `git ${args[0] ?? ''} a échoué`);
    return r.sortie;
  }
}
