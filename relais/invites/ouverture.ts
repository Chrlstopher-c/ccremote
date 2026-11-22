// Responsabilité : l'ouverture d'une session par un invité — le corps est réécrit ici (jamais repris de l'invité), le
// cadre (espace, configuration, lecture, prompt) est posé ici, les limites sont vérifiées ici.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { CadreInvite } from '../../commun/cadre-invite.ts';
import { type ReglagesInvite, verifierOuverture } from '../../commun/invites.ts';
import { EffortSession } from '../../commun/session.ts';
import { NOMBRE_MAX_PIECES, PieceJointe } from '../../commun/presentation.ts';

/** Ce que l'invité peut donner : message, titre, objectif, modèle, effort, prompt de conversation, jointes. */
export const CorpsInvite = z.object({
  message: z.string().min(1),
  titre: z.string().max(120).optional(),
  objectif: z.string().nullable().optional(),
  modele: z.string().min(1).max(120).optional(),
  effort: EffortSession.optional(),
  prompt_systeme: z.string().max(8000).optional(),
  pieces: z.array(PieceJointe).max(NOMBRE_MAX_PIECES).optional(),
});

export interface CtxOuverture {
  readonly moi: string; // membre de ce nœud dans la charte
  readonly machine: string; // nom de la machine locale (postes, projets)
  readonly reglages: ReglagesInvite;
  readonly nom: string;
  readonly compteDeMoi: string | null;
  readonly compteSurSaMachine: boolean;
  readonly sessionsEnCours: number;
  readonly consomme5h: number | null;
  readonly consommeSemaine: number | null;
  readonly racines: readonly string[];
  readonly racine: string; // dossier des espaces d'invités (LANTERNE_INVITES_DOSSIER ou ~/lanterne-invites)
  readonly home: string;
}

export type OuvertureInvite =
  | { readonly ok: true; readonly corps: Record<string, unknown>; readonly cadre: CadreInvite }
  | { readonly ok: false; readonly statut: number; readonly raison: string };

/** Dossier des espaces : hors des chemins sensibles (config, données, Claude), sinon rien ne marcherait. */
export function racineAcceptable(racine: string, home: string): boolean {
  const interdits = [join(home, '.config'), join(home, '.local', 'share'), join(home, '.claude'), join(home, '.ssh')];
  const r = resolve(racine);
  return !interdits.some((i) => r === i || r.startsWith(`${i}/`));
}

/** Corps lu d'un texte JSON (null si absent ou illisible). */
export function corpsLu(texte: string | undefined): Record<string, unknown> | null {
  if (texte === undefined) return null;
  try {
    const lu = z.record(z.string(), z.unknown()).safeParse(JSON.parse(texte));
    return lu.success ? lu.data : null;
  } catch {
    return null;
  }
}

function refus(statut: number, raison: string): OuvertureInvite {
  return { ok: false, statut, raison };
}

/** Crée l'espace et la configuration d'un invité (700) ; échec → refus (journal fait par l'appelant). */
function creerDossiers(racine: string, membre: string): { espace: string; config: string } | null {
  const espace = join(racine, membre, 'espace');
  const config = join(racine, membre, 'config');
  try {
    mkdirSync(espace, { recursive: true, mode: 0o700 });
    mkdirSync(config, { recursive: true, mode: 0o700 });
    return { espace, config };
  } catch {
    return null;
  }
}

/** Prépare l'ouverture demandée par l'invité `membre` : limites vérifiées, corps réécrit, cadre posé. */
export function preparerOuverture(ctx: CtxOuverture, membre: string, texte: string | undefined): OuvertureInvite {
  if (!racineAcceptable(ctx.racine, ctx.home)) return refus(500, 'dossier des espaces non permis');
  const lu = CorpsInvite.safeParse(corpsLu(texte));
  if (!lu.success) return refus(400, 'corps de session invalide');
  const verdict = verifierOuverture(ctx.reglages, {
    machine: ctx.moi,
    machineInvite: membre,
    modele: lu.data.modele ?? null,
    effort: lu.data.effort ?? null,
    sessionsEnCours: ctx.sessionsEnCours,
    consomme5h: ctx.consomme5h,
    consommeSemaine: ctx.consommeSemaine,
    compteSurSaMachine: ctx.compteSurSaMachine,
  });
  if (!verdict.ok) return refus(403, verdict.raison);
  const dossiers = creerDossiers(ctx.racine, membre);
  if (dossiers === null) return refus(500, 'espace de l’invité indisponible');
  const cadre = cadreDe(ctx, membre, dossiers);
  const corps = {
    machine: ctx.machine,
    projet: { machine: ctx.machine, chemin: dossiers.espace, nom: `Espace de ${ctx.nom}` },
    message: lu.data.message,
    ...(lu.data.titre ? { titre: lu.data.titre } : {}),
    objectif: lu.data.objectif ?? null,
    autonomie: false,
    mode: 'default',
    modele: verdict.modele,
    effort: verdict.effort,
    ...(ctx.compteDeMoi ? { compte: ctx.compteDeMoi } : {}),
    ...(lu.data.prompt_systeme ? { prompt_systeme: lu.data.prompt_systeme } : {}),
    ...(lu.data.pieces ? { pieces: lu.data.pieces } : {}),
    controle_distant: false,
    rapide: false,
    ultracode: false,
  };
  return { ok: true, corps, cadre };
}

function cadreDe(ctx: CtxOuverture, membre: string, d: { espace: string; config: string }): CadreInvite {
  const acces = ctx.reglages.acces;
  return {
    membre,
    nom: ctx.nom,
    espace: d.espace,
    config: d.config,
    lecture: acces.fichiersHors ? [...ctx.racines] : [],
    prompt: ctx.reglages.prompt,
    remoteControl: acces.remoteControl,
  };
}
