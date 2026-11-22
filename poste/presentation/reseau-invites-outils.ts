// Responsabilité : les outils `reseau_invite_*` du serveur `lanterne` — le chef ajoute un invité au réseau, règle ses
// limites à la demande et lit son activité. Tout changement attend la confirmation de Chris dans l'appli ; l'aide des
// invités (ressources/aide/invites.md) est rendue telle quelle. Les routes sont celles du nœud (relais).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { FAMILLES, ReglagesInvite } from '../../commun/invites.ts';
import { EffortSession } from '../../commun/session.ts';
import { type ApiMachinesOutils, appeler, confirmer, messageErreur } from './machines-outils.ts';
import type { Resultat } from './outils.ts';

export const CHEMIN_AIDE = join(import.meta.dir, '..', '..', 'ressources', 'aide', 'invites.md');
export const MEMBRE = z.string().regex(/^[a-f0-9]{12}$/);
const PART = z.number().int().min(0).max(100);

export const DESCRIPTION_AIDE =
  'Lire l’aide des invités : ce qu’est un invité sur le réseau, ce qu’il peut faire, comment régler ses limites. ' +
  'À lire avant de répondre à Chris sur les invités.';

export const DESCRIPTION_INVITER =
  'Ajouter un invité au réseau. Un pair déjà membre devient invité, avec les réglages par défaut (Haiku et Sonnet, ' +
  '25 % des limites, 2 sessions simultanées). `membre` : identifiant de 12 caractères du membre. Chris dit « invite ' +
  'Elie » → appelle reseau_inviter. Chris confirme dans l’appli.';

export const DESCRIPTION_REGLER =
  'Changer les limites d’un invité : modèles et efforts, part des limites 5 h et hebdo, sessions simultanées, ' +
  'machines, prompt imposé, accès, télémétrie. N’envoyer que les champs à changer ; les autres restent. ' +
  'Chris dit « Elie n’a plus Opus » → appelle reseau_invite_regler avec `modeles` sans opus. Chris confirme ' +
  'dans l’appli, qui montre ce qui change.';

export const DESCRIPTION_ACTIVITE =
  'Lire l’activité d’un invité : actif aujourd’hui, sessions du jour et en cours, jetons, part de sa limite 5 h. ' +
  'Chris dit « qu’est-ce que fait Elie » → appelle reseau_invite_activite. Lecture seule, sans confirmation.';

const ACCES = z.object({
  remoteControl: z.boolean().optional(),
  terminaux: z.boolean().optional(),
  sessionsAutres: z.boolean().optional(),
  modules: z.boolean().optional(),
  fichiersHors: z.boolean().optional(),
});

/** Champs réglables, tous facultatifs : seuls ceux qui sont donnés changent. */
export const CHAMPS_REGLER = {
  membre: MEMBRE,
  modeles: z.partialRecord(z.enum(FAMILLES), z.array(EffortSession)).optional(),
  part5h: PART.optional(),
  partSemaine: PART.nullable().optional(),
  simultanees: z.number().int().min(1).max(10).optional(),
  machines: z.array(z.string().min(1).max(40)).max(20).optional(),
  surSaMachine: z.boolean().optional(),
  prompt: z.string().max(8000).optional(),
  acces: ACCES.optional(),
  telemetrie: z.boolean().optional(),
};

export interface ArgsRegler {
  readonly membre: string;
  readonly acces?: z.infer<typeof ACCES> | undefined;
  readonly [cle: string]: unknown;
}

const REFUS: Resultat = { texte: 'Chris n’a pas confirmé : rien n’a été changé.', erreur: false };
const VUE_CHARTE = z.object({
  charte: z.object({ membres: z.array(z.object({ id: z.string(), invite: ReglagesInvite.optional() })) }).nullable(),
});
const ACTIVITE = z.object({
  telemetrie: z.boolean(),
  activite: z
    .object({
      actifAujourdhui: z.boolean(),
      sessionsAujourdhui: z.number(),
      sessionsEnCours: z.number(),
      jetonsAujourdhui: z.number(),
      part5h: z.object({ consomme: z.number(), part: z.number() }).nullable().optional(),
    })
    .nullable(),
});

const erreur = (texte: string): Resultat => ({ texte, erreur: true });

export async function aideInvites(log: Logger): Promise<Resultat> {
  try {
    return { texte: await readFile(CHEMIN_AIDE, 'utf8'), erreur: false };
  } catch (erreurLecture) {
    log.warn({ err: erreurLecture }, 'aide des invités illisible');
    return erreur('Aide des invités absente de cette version (ressources/aide/invites.md manque).');
  }
}

export async function inviter(api: ApiMachinesOutils, membre: string, log: Logger): Promise<Resultat> {
  const resume = `Inviter « ${membre} » : le pair devient invité, avec les réglages par défaut.`;
  if (!(await confirmer(api, 'inviter_membre', membre, resume))) return REFUS;
  const r = await appeler(api, 'POST', '/api/reseau/invites', { membre });
  log.info({ membre, ok: r.ok }, 'outil invités : invitation');
  if (!r.ok) return messageErreur(r);
  return { texte: `Invité « ${membre} » ajouté. Ses limites : reseau_invite_regler.`, erreur: false };
}

/** Réglages actuels d'un invité lus dans la charte ; un texte d'erreur si le membre n'est pas un invité. */
async function reglagesActuels(api: ApiMachinesOutils, membre: string): Promise<ReglagesInvite | string> {
  const r = await appeler(api, 'GET', '/api/reseau/charte');
  if (!r.ok) return messageErreur(r).texte;
  const vue = VUE_CHARTE.safeParse(r.corps);
  if (!vue.success) return 'Réponse inattendue du nœud pour la charte.';
  const cible = vue.data.charte?.membres.find((m) => m.id === membre);
  if (!cible) return 'Membre inconnu du réseau.';
  return cible.invite ?? 'Ce membre n’est pas invité : reseau_inviter d’abord.';
}

/** Les réglages actuels, avec les champs donnés par-dessus (`acces` fusionné champ par champ). */
function fusionner(actuels: ReglagesInvite, champs: ArgsRegler): unknown {
  const donnes = Object.fromEntries(Object.entries(champs).filter(([cle, v]) => cle !== 'membre' && v !== undefined));
  return { ...actuels, ...donnes, acces: { ...actuels.acces, ...(champs.acces ?? {}) } };
}

function champsChangés(actuels: ReglagesInvite, nouveaux: ReglagesInvite): string[] {
  const cles = Object.keys(nouveaux) as (keyof ReglagesInvite)[];
  return cles.filter((c) => JSON.stringify(actuels[c]) !== JSON.stringify(nouveaux[c]));
}

export async function reglerInvite(api: ApiMachinesOutils, a: ArgsRegler, log: Logger): Promise<Resultat> {
  const actuels = await reglagesActuels(api, a.membre);
  if (typeof actuels === 'string') return erreur(actuels);
  const valide = ReglagesInvite.safeParse(fusionner(actuels, a));
  if (!valide.success) return erreur(`Réglages refusés : ${valide.error.issues.map((i) => i.message).join(' ; ')}`);
  const modifies = champsChangés(actuels, valide.data);
  if (modifies.length === 0) return { texte: 'Rien à changer : ces réglages sont déjà en place.', erreur: false };
  const resume = `Régler l’invité « ${a.membre} » : changent ${modifies.join(', ')}.`;
  if (!(await confirmer(api, 'regler_invite', a.membre, resume))) return REFUS;
  const r = await appeler(api, 'POST', `/api/reseau/charte/membres/${a.membre}/invite`, { reglages: valide.data });
  log.info({ membre: a.membre, champs: modifies, ok: r.ok }, 'outil invités : réglages');
  if (!r.ok) return messageErreur(r);
  return { texte: `Réglages de l’invité enregistrés (${modifies.join(', ')}).`, erreur: false };
}

function texteActivite(corps: unknown): string {
  const lue = ACTIVITE.safeParse(corps);
  if (!lue.success) return 'Réponse inattendue du nœud pour l’activité.';
  if (!lue.data.telemetrie) return 'Télémétrie coupée pour cet invité : aucune activité remontée.';
  const a = lue.data.activite;
  if (!a) return 'Pas encore d’activité remontée pour cet invité.';
  const lignes = [
    `Actif aujourd’hui : ${a.actifAujourdhui ? 'oui' : 'non'}`,
    `Sessions aujourd’hui : ${a.sessionsAujourdhui} (en cours : ${a.sessionsEnCours})`,
    `Jetons aujourd’hui : ${a.jetonsAujourdhui}`,
  ];
  if (a.part5h) lignes.push(`Limite 5 h : consommé ${a.part5h.consomme}, part ${a.part5h.part}`);
  return lignes.join('\n');
}

export async function activiteInvite(api: ApiMachinesOutils, membre: string): Promise<Resultat> {
  const r = await appeler(api, 'GET', `/api/reseau/invites/${encodeURIComponent(membre)}/activite`);
  return r.ok ? { texte: texteActivite(r.corps), erreur: false } : messageErreur(r);
}
