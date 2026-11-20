// Responsabilité : la demande de fusion (PR) de la branche d'une session (P3) — lecture par `gh pr view`, création par
// `git push -u origin HEAD` puis `gh pr create`, toujours dans le dossier de la session. Tableaux d'arguments, jamais
// de shell : le titre et le corps de Chris ne deviennent jamais une commande.
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  type CorpsFusion,
  type DemandeFusion,
  DELAI_FUSION_MS,
  type EtatFusion,
  type ResultatFusion,
} from '../../commun/reste-lot2.ts';
import { lancerProgramme, premiereLigne } from './processus.ts';

const CHAMPS_PR = 'number,title,url,state,isDraft';
const AUCUNE_PR = /no pull requests? found/i;
const NON_CONNECTE = /gh auth login|not logged/i;

const PrGh = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
});

type LecturePr = { readonly pr: DemandeFusion | null } | { readonly raison: string };

/** Branche courante du dossier et sa PR (null si la branche n'en a pas), ou la raison de l'absence de lecture. */
export async function etatFusion(cwd: string, journal: Logger): Promise<EtatFusion> {
  const branche = await lancerProgramme(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd, DELAI_FUSION_MS, journal);
  if (branche.absent) return { etat: 'absente', raison: 'git introuvable sur ce poste' };
  if (branche.code !== 0) return { etat: 'absente', raison: 'dossier non suivi par git, ou sans commit' };
  const lecture = await lirePr(cwd, journal);
  if ('raison' in lecture) return { etat: 'absente', raison: lecture.raison };
  return { etat: 'ok', branche: branche.sortie, pr: lecture.pr };
}

/** Pousse la branche, crée la PR (brouillon si demandé), puis la relit. Jamais de PR sans push réussi. */
export async function creerFusion(cwd: string, corps: CorpsFusion, journal: Logger): Promise<ResultatFusion> {
  const push = await lancerProgramme(['git', 'push', '-u', 'origin', 'HEAD'], cwd, DELAI_FUSION_MS, journal);
  if (push.absent) return echecFusion('git introuvable sur ce poste');
  if (push.code !== 0) return echecFusion(`push impossible : ${premiereLigne(push.erreur)}`);
  const argv = ['gh', 'pr', 'create', `--title=${corps.titre}`, `--body=${corps.corps}`];
  if (corps.brouillon) argv.push('--draft');
  const cree = await lancerProgramme(argv, cwd, DELAI_FUSION_MS, journal);
  if (cree.absent) return echecFusion('gh introuvable sur ce poste');
  if (cree.code !== 0) return echecFusion(`création de la PR impossible : ${premiereLigne(cree.erreur)}`);
  const lecture = await lirePr(cwd, journal);
  if ('raison' in lecture || lecture.pr === null) {
    return echecFusion('PR créée, mais sa relecture a échoué');
  }
  return { etat: 'ok', pr: lecture.pr };
}

function echecFusion(raison: string): ResultatFusion {
  return { etat: 'erreur', raison };
}

// `gh pr view` sur la branche courante : aucune PR n'est une réponse (pr null), pas une erreur.
async function lirePr(cwd: string, journal: Logger): Promise<LecturePr> {
  const r = await lancerProgramme(['gh', 'pr', 'view', '--json', CHAMPS_PR], cwd, DELAI_FUSION_MS, journal);
  if (r.absent) return { raison: 'gh introuvable sur ce poste' };
  if (r.code === 0) return prDe(r.sortie);
  if (AUCUNE_PR.test(r.erreur)) return { pr: null };
  if (NON_CONNECTE.test(r.erreur)) return { raison: 'gh non connecté sur ce poste (gh auth login)' };
  return { raison: `gh pr view en échec : ${premiereLigne(r.erreur)}` };
}

// La forme lue de gh, rangée dans le contrat : un brouillon ouvert est DRAFT. Illisible : raison, pas « aucune PR ».
function prDe(sortie: string): LecturePr {
  let brut: unknown;
  try {
    brut = JSON.parse(sortie);
  } catch {
    return { raison: 'réponse de gh illisible' };
  }
  const lu = PrGh.safeParse(brut);
  if (!lu.success) return { raison: 'réponse de gh illisible' };
  const { number, title, url, state, isDraft } = lu.data;
  const etat = state === 'OPEN' && isDraft ? 'DRAFT' : state;
  return { pr: { numero: number, titre: title, url, etat } };
}
