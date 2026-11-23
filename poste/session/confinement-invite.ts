// Responsabilité : le confinement d'une session d'invité côté poste — crochet PreToolUse (tous les appels) et
// permission canUseTool, qui refusent tout outil ou chemin hors de l'espace, toute adresse privée pour WebFetch, et
// tout échec de vérification (échec fermé, loguée). Jamais de question posée à Chris.
import { lookup } from 'node:dns/promises';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { CanUseTool, HookCallbackMatcher, HookJSONOutput, HookInput } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { CadreInvite } from '../../commun/cadre-invite.ts';
import {
  adressePrivee,
  type Confinement,
  verifierOutil,
  verifierUrlSyntaxe,
  type VerdictAcces,
} from '../../commun/invites-outils.ts';

const ENTREE = z.record(z.string(), z.unknown());

function existe(chemin: string): boolean {
  try {
    lstatSync(chemin); // un lien symbolique cassé existe aussi : sa résolution échouera, donc refus
    return true;
  } catch {
    return false;
  }
}

/** Chemin réel : le plus proche parent existant est résolu (realpath), le reste s'y ajoute tel quel. */
export function resoudrePlusProche(chemin: string): string {
  let existant = chemin;
  const reste: string[] = [];
  while (!existe(existant)) {
    const parent = dirname(existant);
    if (parent === existant) break;
    reste.unshift(basename(existant));
    existant = parent;
  }
  return join(realpathSync(existant), ...reste);
}

function racineReelle(chemin: string): string {
  return existsSync(chemin) ? realpathSync(chemin) : chemin;
}

/** Terminal : accordé par le chef ET session sur la machine de l'invité (par le relais), jamais chez le chef. */
export function terminalPermis(cadre: CadreInvite): boolean {
  return cadre.terminaux === true && cadre.relais !== undefined;
}

/** Le confinement d'un cadre : espace et racines de lecture réelles ; lève si l'espace n'existe pas. */
export function confinementDe(cadre: CadreInvite): Confinement {
  return {
    terminal: terminalPermis(cadre),
    local: cadre.relais !== undefined,
    espace: realpathSync(cadre.espace),
    // Mode Plan chez lui : Claude Code écrit ses plans dans <configuration>/plans.
    ...(cadre.relais !== undefined ? { plans: racineReelle(join(cadre.config, 'plans')) } : {}),
    lecture: cadre.lecture.map(racineReelle),
    home: homedir(),
    resoudre: resoudrePlusProche,
  };
}

/** Pour WebFetch : syntaxe de l'URL, puis résolution DNS de l'hôte ; toute adresse privée refuse l'appel. */
async function verifierResolution(url: unknown): Promise<VerdictAcces> {
  const syntaxe = verifierUrlSyntaxe(url);
  if (!syntaxe.ok) return syntaxe;
  const adresses = await lookup(syntaxe.hote, { all: true });
  const privee = adresses.some((a) => adressePrivee(a.address));
  return privee ? { ok: false, raison: 'adresse privée ou locale' } : { ok: true };
}

/** Verdict d'un appel d'outil ; toute exception (y compris DNS) devient un refus, loguée. */
export async function verdictOutil(
  c: Confinement,
  nom: string,
  entree: unknown,
  journal: Logger,
): Promise<VerdictAcces> {
  try {
    const valeurs = ENTREE.safeParse(entree);
    const champs = valeurs.success ? valeurs.data : {};
    const base = verifierOutil(c, nom, champs);
    if (!base.ok || nom !== 'WebFetch') return base;
    return await verifierResolution(champs['url']);
  } catch (erreur) {
    journal.warn({ err: erreur, outil: nom }, 'confinement invité : vérification en échec, outil refusé');
    return { ok: false, raison: 'vérification impossible' };
  }
}

/** Crochet PreToolUse de la session d'invité : un seul, pour tous les outils ; refus = permissionDecision deny. */
export function crochetConfinement(c: Confinement, journal: Logger): HookCallbackMatcher {
  return {
    hooks: [
      async (entree: HookInput): Promise<HookJSONOutput> => {
        if (entree.hook_event_name !== 'PreToolUse') return {};
        const verdict = await verdictOutil(c, entree.tool_name, entree.tool_input, journal);
        if (verdict.ok) return {};
        journal.info({ outil: entree.tool_name, raison: verdict.raison }, 'confinement invité : outil refusé');
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: verdict.raison,
          },
        };
      },
    ],
  };
}

/** Permission des outils soumis à demande : même vérification, jamais de question à Chris. */
export function permissionInvite(c: Confinement, journal: Logger): CanUseTool {
  return async (nom, entree) => {
    const verdict = await verdictOutil(c, nom, entree, journal);
    return verdict.ok ? { behavior: 'allow', updatedInput: entree } : { behavior: 'deny', message: verdict.raison };
  };
}
