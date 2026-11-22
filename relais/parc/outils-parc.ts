// Responsabilité : les outils du parc côté relais, pour les sessions hors de Lanterne — machines, sessions, fil, envoi,
// ouverture, réponse et réveil. Chaque opération passe par la fonction de la route HTTP correspondante (aucune logique
// dupliquée) : une requête interne sans jeton, le lien du poste étant déjà authentifié. Une erreur devient une réponse.
import type { Logger } from 'pino';
import type { z } from 'zod';
import type { ReponseRelais } from '../../commun/modules.ts';
import {
  ArgsParcEnvoyer,
  ArgsParcFil,
  ArgsParcOuvrir,
  ArgsParcRepondre,
  ArgsParcReveiller,
  ArgsParcSessions,
  LIMITE_FIL_DEFAUT_PARC,
  type MachineParc,
  type OperationParc,
  QuoiParc,
  type SessionParc,
  STATUTS_VIVANTS_PARC,
} from '../../commun/parc.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { ApiSessions } from '../clients/api-sessions.ts';
import type { ApiEntretien } from '../entretien/api-entretien.ts';
import type { Postes } from './postes.ts';
import type { Registre } from '../registre/registre.ts';

const BASE_INTERNE = 'http://relais.interne';

export interface DependancesOutilsParc {
  readonly postes: Pick<Postes, 'vues'>;
  readonly registre: Pick<Registre, 'sessions'>;
  readonly sessions: ApiSessions;
  readonly entretien: Pick<ApiEntretien, 'reveiller' | 'reveilPossibles'>;
  readonly journal: Logger;
}

type Analyse<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly refus: ReponseRelais };
type RequeteSession = Request & { readonly params: { readonly id: string } };
type Traitement = (d: DependancesOutilsParc, args: unknown) => Promise<ReponseRelais>;

/** Les arguments de l'opération, validés ; sinon un refus lisible, sans rien lire ni envoyer. */
function analyser<S extends z.ZodType>(schema: S, args: unknown): Analyse<z.infer<S>> {
  const lue = schema.safeParse(args);
  if (lue.success) return { ok: true, valeur: lue.data };
  const detail = lue.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' ; ');
  return { ok: false, refus: { ok: false, erreur: `arguments invalides : ${detail}` } };
}

function requete(chemin: string, corps?: unknown): Request {
  if (corps === undefined) return new Request(`${BASE_INTERNE}${chemin}`);
  return new Request(`${BASE_INTERNE}${chemin}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });
}

function requeteSession(id: string, chemin: string, corps?: unknown): RequeteSession {
  return Object.assign(requete(chemin, corps), { params: { id } });
}

function cheminSession(id: string, action: string): string {
  return `/api/sessions/${encodeURIComponent(id)}/${action}`;
}

function lireTexte(texte: string): unknown {
  if (texte === '') return null;
  try {
    const valeur: unknown = JSON.parse(texte);
    return valeur;
  } catch {
    return texte;
  }
}

function messageDe(corps: unknown, statut: number): string {
  if (typeof corps === 'object' && corps !== null && 'erreur' in corps && typeof corps.erreur === 'string') {
    return corps.erreur;
  }
  return `échec (HTTP ${statut})`;
}

/** La réponse d'une route : son corps en succès, son message d'erreur sinon. */
async function enReponse(r: Response): Promise<ReponseRelais> {
  const corps = lireTexte(await r.text());
  if (r.ok) return { ok: true, donnees: corps };
  return { ok: false, erreur: messageDe(corps, r.status) };
}

function projeterSession(s: ResumeSession): SessionParc {
  return {
    id: s.id,
    machine: s.machine,
    titre: s.titre,
    projet: s.projet.nom,
    statut: s.statut,
    majLe: s.majLe,
    terminal: s.terminal === true,
    dialogue: s.dialogue ? { id: s.dialogue.id, titre: s.dialogue.titre } : null,
  };
}

async function machines(d: DependancesOutilsParc): Promise<ReponseRelais> {
  const possibles = new Set(d.entretien.reveilPossibles());
  const liste: MachineParc[] = d.postes.vues().map((v) => ({
    id: v.id,
    description: v.description,
    enLigne: v.enLigne,
    reveilPossible: possibles.has(v.id),
  }));
  return { ok: true, donnees: { machines: liste } };
}

async function reveiller(d: DependancesOutilsParc, args: unknown): Promise<ReponseRelais> {
  const a = analyser(ArgsParcReveiller, args);
  if (!a.ok) return a.refus;
  d.journal.info({ machine: a.valeur.machine }, 'réveil demandé par un outil du parc');
  return enReponse(await d.entretien.reveiller(a.valeur.machine));
}

async function sessions(d: DependancesOutilsParc, args: unknown): Promise<ReponseRelais> {
  const a = analyser(ArgsParcSessions, args);
  if (!a.ok) return a.refus;
  const vivantes = new Set<string>(STATUTS_VIVANTS_PARC);
  const liste = d.registre
    .sessions(false)
    .filter((s) => a.valeur.machine === undefined || s.machine === a.valeur.machine)
    .filter((s) => a.valeur.toutes === true || vivantes.has(s.statut))
    .map(projeterSession);
  return { ok: true, donnees: { sessions: liste } };
}

async function fil(d: DependancesOutilsParc, args: unknown): Promise<ReponseRelais> {
  const a = analyser(ArgsParcFil, args);
  if (!a.ok) return a.refus;
  const { session, limite = LIMITE_FIL_DEFAUT_PARC } = a.valeur;
  const r = await enReponse(await d.sessions.evenements(requeteSession(session, cheminSession(session, 'evenements'))));
  if (!r.ok || !Array.isArray(r.donnees)) return r;
  return { ok: true, donnees: r.donnees.slice(-limite) };
}

async function envoyer(d: DependancesOutilsParc, args: unknown): Promise<ReponseRelais> {
  const a = analyser(ArgsParcEnvoyer, args);
  if (!a.ok) return a.refus;
  const { session, texte } = a.valeur;
  d.journal.info({ session }, 'envoi par un outil du parc');
  return enReponse(await d.sessions.envoyer(requeteSession(session, cheminSession(session, 'messages'), { texte })));
}

async function ouvrir(d: DependancesOutilsParc, args: unknown): Promise<ReponseRelais> {
  const a = analyser(ArgsParcOuvrir, args);
  if (!a.ok) return a.refus;
  const { machine, dossier, message, titre } = a.valeur;
  const nom = dossier.split('/').filter(Boolean).pop() ?? dossier;
  d.journal.info({ machine, dossier }, 'ouverture par un outil du parc');
  const projet = { machine, chemin: dossier, nom };
  return enReponse(await d.sessions.ouvrir(requete('/api/sessions', { machine, projet, message, titre })));
}

async function repondre(d: DependancesOutilsParc, args: unknown): Promise<ReponseRelais> {
  const a = analyser(ArgsParcRepondre, args);
  if (!a.ok) return a.refus;
  const { session, dialogue, index, texte } = a.valeur;
  const reponse = {
    id: dialogue,
    ...(index === undefined ? {} : { index }),
    ...(texte === undefined ? {} : { texte }),
  };
  d.journal.info({ session, dialogue }, 'réponse par un outil du parc');
  return enReponse(await d.sessions.repondre(requeteSession(session, cheminSession(session, 'repondre'), reponse)));
}

const TRAITEMENTS: { readonly [operation in OperationParc]: Traitement } = {
  parc_machines: (d) => machines(d),
  parc_reveiller: reveiller,
  parc_sessions: sessions,
  parc_fil: fil,
  parc_envoyer: envoyer,
  parc_ouvrir: ouvrir,
  parc_repondre: repondre,
};

export function estOperationParc(quoi: string): quoi is OperationParc {
  return QuoiParc.safeParse(quoi).success;
}

/** Une opération du parc, traitée comme la route HTTP correspondante ; hors liste, un refus sans rien faire. */
export async function traiterRequeteParc(
  d: DependancesOutilsParc,
  quoi: string,
  args: unknown,
): Promise<ReponseRelais> {
  if (!estOperationParc(quoi)) {
    d.journal.warn({ operation: quoi }, 'opération du parc hors liste refusée');
    return { ok: false, erreur: 'opération hors liste' };
  }
  try {
    const r = await TRAITEMENTS[quoi](d, args);
    d.journal.info({ operation: quoi, ok: r.ok }, 'outil du parc');
    return r;
  } catch (erreur) {
    d.journal.error({ err: erreur, operation: quoi }, 'outil du parc en échec');
    return { ok: false, erreur: 'erreur interne du relais' };
  }
}
