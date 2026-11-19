// Responsabilité : lire et modifier les connecteurs MCP de l'utilisateur (portée `user`). La lecture passe par la clé
// `mcpServers` de `~/.claude.json` ; l'écriture passe toujours par `claude mcp add-json | remove -s user`. Une valeur
// masquée renvoyée à la modification garde l'ancienne valeur ; la modification est retirer + ajouter, avec restauration.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { type DefinitionConnecteur, MASQUE_VALEUR } from '../../commun/configuration.ts';
import type { LanceurClaude, SortieCommande } from './exec.ts';

export type ResultatEdition = { readonly ok: true } | { readonly ok: false; readonly erreur: string };

const BrutConnecteur = z.object({
  type: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
type BrutConnecteur = z.infer<typeof BrutConnecteur>;

export function fichierConfigClaude(): string {
  const dossier = process.env['CLAUDE_CONFIG_DIR'];
  return dossier ? join(dossier, '.claude.json') : join(homedir(), '.claude.json');
}

/** Forme attendue par `claude mcp add-json` : `stdio` (command, args, env) ou `http`/`sse` (url, headers). */
export function jsonClaude(def: DefinitionConnecteur): Record<string, unknown> {
  if (def.type === 'stdio') return { type: 'stdio', command: def.commande, args: def.arguments, env: def.variables };
  return { type: def.type, url: def.url, headers: def.entetes };
}

/** Entrée brute de `mcpServers` pour ce nom, ou `null` si absente ou illisible. */
export function lireBrutConnecteur(nom: string, journal: Logger): Record<string, unknown> | null {
  const fichier = fichierConfigClaude();
  if (!existsSync(fichier)) return null;
  try {
    const lu = z
      .object({ mcpServers: z.record(z.string(), z.unknown()).optional() })
      .safeParse(JSON.parse(readFileSync(fichier, 'utf8')));
    const entree = lu.success ? lu.data.mcpServers?.[nom] : undefined;
    return entree && typeof entree === 'object' ? (entree as Record<string, unknown>) : null;
  } catch (erreur) {
    journal.warn({ err: erreur, fichier }, 'configuration Claude illisible');
    return null;
  }
}

function masquer(valeurs: Record<string, string> | undefined, reveler: boolean): Record<string, string> {
  const lues = valeurs ?? {};
  return Object.fromEntries(Object.entries(lues).map(([cle, val]) => [cle, reveler ? val : MASQUE_VALEUR]));
}

/** Définition lisible d'une entrée brute ; valeurs de variables et d'en-têtes masquées sauf `reveler`. */
export function definitionDe(
  nom: string,
  brut: Record<string, unknown>,
  reveler: boolean,
): DefinitionConnecteur | null {
  const lu = BrutConnecteur.safeParse(brut);
  if (!lu.success) return null;
  const b = lu.data;
  const type = b.type ?? (b.command !== undefined ? 'stdio' : 'http');
  if (type === 'stdio') {
    return {
      nom,
      type,
      commande: b.command ?? '',
      arguments: b.args ?? [],
      variables: masquer(b.env, reveler),
      entetes: {},
    };
  }
  if (type !== 'http' && type !== 'sse') return null;
  return { nom, type, url: b.url ?? '', arguments: [], variables: {}, entetes: masquer(b.headers, reveler) };
}

function valeursMasquees(def: DefinitionConnecteur): boolean {
  return [...Object.values(def.variables), ...Object.values(def.entetes)].includes(MASQUE_VALEUR);
}

/** Remplace chaque valeur masquée par l'ancienne valeur de la même clé ; une clé nouvelle masquée est refusée. */
export function fusionnerMasques(
  def: DefinitionConnecteur,
  avant: BrutConnecteur,
): { readonly ok: true; readonly def: DefinitionConnecteur } | { readonly ok: false; readonly erreur: string } {
  const variables = remplacerMasques(def.variables, avant.env ?? {});
  const entetes = remplacerMasques(def.entetes, avant.headers ?? {});
  const perdues = [...variables.perdues, ...entetes.perdues];
  if (perdues.length > 0) return { ok: false, erreur: `valeur à saisir : ${perdues.join(', ')}` };
  return { ok: true, def: { ...def, variables: variables.valeurs, entetes: entetes.valeurs } };
}

function remplacerMasques(
  valeurs: Record<string, string>,
  anciennes: Record<string, string>,
): { readonly valeurs: Record<string, string>; readonly perdues: string[] } {
  const perdues: string[] = [];
  const nouvelles = Object.fromEntries(
    Object.entries(valeurs).map(([cle, val]) => {
      if (val !== MASQUE_VALEUR) return [cle, val];
      if (anciennes[cle] === undefined) perdues.push(cle);
      return [cle, anciennes[cle] ?? ''];
    }),
  );
  return { valeurs: nouvelles, perdues };
}

function messageClaude(r: SortieCommande): string {
  const lignes = `${r.erreurs}\n${r.sortie}`
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (r.delaiDepasse) return 'délai dépassé';
  return lignes.at(-1) ?? `claude a échoué (code ${r.code})`;
}

async function ajouterBrut(
  lancer: LanceurClaude,
  nom: string,
  objet: Record<string, unknown>,
): Promise<ResultatEdition> {
  const r = await lancer(['mcp', 'add-json', nom, JSON.stringify(objet), '-s', 'user']);
  return r.code === 0 && !r.delaiDepasse ? { ok: true } : { ok: false, erreur: messageClaude(r) };
}

export async function ajouterConnecteur(lancer: LanceurClaude, def: DefinitionConnecteur): Promise<ResultatEdition> {
  if (valeursMasquees(def)) return { ok: false, erreur: 'valeur à saisir : la valeur est masquée' };
  return ajouterBrut(lancer, def.nom, jsonClaude(def));
}

export async function retirerConnecteur(lancer: LanceurClaude, nom: string): Promise<ResultatEdition> {
  const r = await lancer(['mcp', 'remove', nom, '-s', 'user']);
  return r.code === 0 && !r.delaiDepasse ? { ok: true } : { ok: false, erreur: messageClaude(r) };
}

/** Retire l'ancien connecteur, ajoute le nouveau ; si l'ajout échoue, l'ancienne entrée brute est remise à l'identique. */
export async function modifierConnecteur(
  lancer: LanceurClaude,
  journal: Logger,
  nomAvant: string,
  def: DefinitionConnecteur,
): Promise<ResultatEdition> {
  const avant = lireBrutConnecteur(nomAvant, journal);
  if (!avant) return { ok: false, erreur: `connecteur absent au niveau utilisateur : ${nomAvant}` };
  const lu = BrutConnecteur.safeParse(avant);
  if (!lu.success) return { ok: false, erreur: `définition illisible : ${nomAvant}` };
  const fusion = fusionnerMasques(def, lu.data);
  if (!fusion.ok) return fusion;
  const retrait = await retirerConnecteur(lancer, nomAvant);
  if (!retrait.ok) return retrait;
  const ajout = await ajouterBrut(lancer, fusion.def.nom, jsonClaude(fusion.def));
  if (ajout.ok) return ajout;
  const restauree = await ajouterBrut(lancer, nomAvant, avant);
  journal.warn({ connecteur: nomAvant, erreur: ajout.erreur }, 'modification de connecteur annulée');
  if (restauree.ok) return ajout;
  return { ok: false, erreur: `${ajout.erreur} ; ancienne définition non restaurée : ${restauree.erreur}` };
}
